import { useCallback, useEffect, useRef } from 'react';
import CameraStreamWorker from '@/workers/cameraStream.worker.ts?worker';
import { ackCameraFrame } from '@/api/camera';
import { flushCameraStream } from '@/api/camera';
import type { CameraFrameMeta, CameraPixelFormat } from '@/types/camera';

// Live-preview subsample factor. The worker decodes a (W/SCALE)×(H/SCALE)
// RGBA ImageData instead of the full sensor resolution. For a 2592×1944 mono8
// source, scale=2 drops conversion work + transfer from 20MB to 5MB. Auto
// Measure does NOT use the downscaled output — it reads the full-resolution
// raw buffer kept in `latestFullFrame` via getLatestFullFrame(). To change the
// preview resolution, edit this constant — must be an integer ≥1.
const PREVIEW_SCALE = 2;

// Stale-frame age threshold (grab→renderer-receive). Lenient enough not to
// drop frames that are naturally old because the camera runs at low FPS
// (e.g. 200ms exposure → 5 FPS, slot age up to 200ms is normal). The
// native atomic-slot already delivers the freshest available frame; this
// gate only catches truly broken pipelines, not normal low-FPS operation.
// Temporarily lenient (was 100ms) so post-stream-restart frames at 8 FPS
// don't all get dropped while we debug the display pipeline. Once the
// pipeline is verified working we can tighten this back to ~50–100ms.
const STALE_AGE_MS = 500;

/**
 * Owns the camera-stream worker. Subscribes to `camera:frame` events on
 * window.api and forwards the binary buffer to the worker as a transferable
 * (zero-copy). When OffscreenCanvas is supported, the worker draws the
 * pixels directly. Otherwise the worker decodes and posts an ImageData back
 * to the main thread, which paints it on the 2D context.
 *
 * Worker + IPC subscription live at MODULE SCOPE — not inside the hook —
 * because:
 *   1. `transferControlToOffscreen` can only be called once per canvas; we
 *      cannot recreate the worker without losing the ability to draw.
 *   2. React 19 StrictMode dev double-invokes effects. A hook-scoped worker
 *      would be terminated on the simulated unmount, leaving a fresh worker
 *      that the canvas can never re-attach to → black preview.
 * The worker is cheap and lives for the page's lifetime; that's fine for a
 * desktop app.
 */

let sharedWorker: Worker | null = null;
type AttachedRef = { el: HTMLCanvasElement; fallbackCtx: CanvasRenderingContext2D | null };
let attached: AttachedRef | null = null;
let ipcSubscribed = false;
let mainThreadPaintHandlerInstalled = false;
let lastFrameAt = 0;
// lastPaintAt tracks when pixels actually landed on the visible canvas (after
// worker decode + main-thread putImageData), not when the IPC body arrived.
// Stale-frame guards must check this, not lastFrameAt — otherwise a guard can
// pass before the worker has round-tripped paint, and capture reads an empty /
// previous-objective canvas.
let lastPaintAt = 0;
// frameEpoch is bumped by bumpFrameEpochOnCanvasClear() whenever the live
// canvas is cleared (objective change). Every IPC frame is tagged with the
// current epoch and the worker echoes it back in 'paint'. Paints whose epoch
// is < frameEpoch are dropped so a frame that was already in the worker queue
// before the clear cannot repaint stale pixels of the previous objective.
let frameEpoch = 0;
let lastPaintEpoch = 0;
// frameId of the most recent paint that actually landed on the canvas. The
// Auto Measure click reads this to tag its snapshot log with the exact frame
// it captured from. inFlightFrameId resets after ack, so it can't be used.
let lastPaintedFrameId = 0;
// Latest-frame-only backpressure. The worker decodes serially; without this,
// frames pile up in its message-port queue and the user sees a delayed replay
// of physical machine movement. Policy: at most ONE frame in-flight in the
// worker + ONE pending frame on the main thread. A newer frame replaces the
// pending one (older queued frames are dropped). The worker's 'paint' echo is
// the "decoder idle" signal that flushes the pending frame.
type LiveFrame = {
  meta: CameraFrameMeta;
  body: ArrayBufferLike;
  frameId: number;
  receivedAt: number;
};

let decoderBusy = false;
let pendingFrame: LiveFrame | null = null;
const latestFrameRef: { current: LiveFrame | null } = { current: null };
const latestFrameIdRef = { current: 0 };
let inFlightCapturedAt = 0;
let inFlightFrameId = 0;
let inFlightGrabTs = 0;
let frameIdCounter = 0;
let lastLatencyLogAt = 0;
let lastRenderLogAt = 0;
let lastRendererRecvLogAt = 0;
let lastWorkerRecvLogAt = 0;
let lastCanvasPresentLogAt = 0;
let latencyDroppedSinceLastSummary = 0;
let staleFramesBeforeTs = 0;
// Pending paint for rAF coalescing. The 2D paint path receives 'paint'
// messages serially from the worker; on a hot loop we could call
// putImageData N times per rAF tick. Coalescing means only the most recent
// ImageData ever lands on the canvas — older paints are dropped at the
// putImageData step, not just at the decode step.
let pendingPaint: {
  imageData: ImageData;
  epoch: number;
  seq: number;
  frameId: number;
  capturedAt: number;
  grabTs: number;
} | null = null;
let rafScheduled = false;
// Reset by resetCameraSession() on close so the next open re-fires the
// first-frame / first-paint logs. The IPC subscription itself stays attached
// for the page lifetime — only the per-session telemetry is reset.
let firstFrameLoggedThisSession = false;
let firstPaintLoggedThisSession = false;

// Most recent FULL-RESOLUTION raw frame, retained for Auto Measure. The body
// reference is the Buffer received over IPC — held without copying. The
// worker only sees a sliced ArrayBuffer (transferred, separate backing
// store), so this reference stays valid across the worker post. Replaced on
// each IPC arrival; the previous body is GC'd once no consumer references it.
let latestFullFrame: {
  body: ArrayBufferLike;
  width: number;
  height: number;
  pixelFormat: CameraPixelFormat;
  bits: 8 | 16;
  capturedAt: number;
  grabTs?: number;
  frameId?: number;
} | null = null;

export function getLatestFullFrame() {
  return latestFullFrame;
}

function getWorker(): Worker {
  if (!sharedWorker) sharedWorker = new CameraStreamWorker();
  return sharedWorker;
}

function recordCameraFrameDrop(_reason = 'stale', _frameId = 0, _ageMs = 0): void {
  latencyDroppedSinceLastSummary += 1;
}

function installMainThreadPaintHandler() {
  if (mainThreadPaintHandlerInstalled) return;
  mainThreadPaintHandlerInstalled = true;
  const worker = getWorker();
  worker.addEventListener(
    'message',
    (e: MessageEvent<{ type: string; imageData?: ImageData; epoch?: number; seq?: number; frameId?: number }>) => {
      if (!e.data || e.data.type !== 'paint' || !e.data.imageData) return;
      const paintEpoch = typeof e.data.epoch === 'number' ? e.data.epoch : 0;
      // Prefer the echoed frameId from the worker — it's the EXACT frame that
      // was just decoded, not whichever post happened to come in between.
      // inFlightFrameId can race with a newer post that ran after worker
      // posted 'paint' but before this handler observed it. Strict positive
      // check; ?? would let an actual 0 through and `||` already does the
      // right thing but we want clarity at the diagnostic step.
      const echoedRaw = (e.data as { frameId?: unknown }).frameId;
      const echoedFrameId =
        typeof echoedRaw === 'number' && echoedRaw > 0 ? echoedRaw : 0;
      const resolvedFrameId =
        echoedFrameId > 0 ? echoedFrameId : inFlightFrameId;
      // Drop paints from a frame received before the latest canvas clear —
      // those pixels belong to the previous objective and would re-pollute
      // the freshly-cleared canvas.
      if (paintEpoch < frameEpoch) {
        recordCameraFrameDrop('stale-epoch', resolvedFrameId);
        decoderBusy = false;
        // Still ack so main process releases its slot — the frame was
        // delivered + decoded; main shouldn't be stuck waiting.
        if (resolvedFrameId > 0) ackCameraFrame(resolvedFrameId);
        flushPendingFrame();
        return;
      }
      // (Previously dropped on `resolvedFrameId < latestFrameIdRef`, but
      // the SDK frame counter can reset on stream restarts, so that gate
      // would blank the live view post-restart. Removed; age gate below
      // is the authority.)
      if (false as boolean) {
        decoderBusy = false;
        ackCameraFrame(resolvedFrameId);
        flushPendingFrame();
        return;
      }
      // Stash latest decoded image; rAF coalesces multiple paints into one
      // putImageData per frame. If a newer paint arrives before rAF fires,
      // it replaces this one — the older pixels never touch the canvas.
      if (pendingPaint) {
        recordCameraFrameDrop('pending-paint-overwrite', pendingPaint.frameId);
        ackCameraFrame(pendingPaint.frameId);
      }
      pendingPaint = {
        imageData: e.data.imageData,
        epoch: paintEpoch,
        seq: e.data.seq ?? 0,
        frameId: resolvedFrameId,
        capturedAt: inFlightCapturedAt,
        grabTs: inFlightGrabTs,
      };
      decoderBusy = false;
      flushPendingFrame();
      schedulePaintRaf();
    }
  );
}

function schedulePaintRaf() {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    const p = pendingPaint;
    pendingPaint = null;
    if (!p) return;
    if (staleFramesBeforeTs > 0 && p.grabTs > 0 && p.grabTs < staleFramesBeforeTs) {
      recordCameraFrameDrop('pre-change-frame', p.frameId, Date.now() - p.grabTs);
      if (p.frameId > 0) ackCameraFrame(p.frameId);
      return;
    }
    // (Previously dropped on p.frameId < latestFrameIdRef. Removed for the
    // same reason as above — SDK counter resets are legitimate, not stale.)
    // Final age gate at paint time. A frame can pass the renderer-inbound
    // gate, then sit through worker decode + rAF (~15–30ms). If the total
    // elapsed since grab now exceeds threshold, skip putImageData — the
    // pixels would be visibly behind the machine.
    if (p.grabTs > 0) {
      const ageAtPaint = Date.now() - p.grabTs;
      if (ageAtPaint > STALE_AGE_MS) {
        recordCameraFrameDrop('over-100ms-before-draw', p.frameId, ageAtPaint);
        if (p.frameId > 0) ackCameraFrame(p.frameId);
        return;
      }
    }
    if (!attached || !attached.fallbackCtx) {
      if (p.frameId > 0) ackCameraFrame(p.frameId);
      return;
    }
    const { el, fallbackCtx } = attached;
    const img = p.imageData;
    if (el.width !== img.width || el.height !== img.height) {
      el.width = img.width;
      el.height = img.height;
    }
    fallbackCtx.putImageData(img, 0, 0);
    lastPaintAt = Date.now();
    lastPaintEpoch = p.epoch;
    lastPaintedFrameId = p.frameId;
    if (lastPaintAt - lastCanvasPresentLogAt >= 5000) {
      lastCanvasPresentLogAt = lastPaintAt;
    }
    // [camera-render] — grab→pixels-on-canvas latency, throttled 1Hz. This is
    // the number the user actually sees. Stage labels: native, ipc, render.
    if (lastPaintAt - lastRenderLogAt > 5000) {
      lastRenderLogAt = lastPaintAt;
    }
    if (!firstPaintLoggedThisSession) {
      firstPaintLoggedThisSession = true;
    }
    if (lastPaintAt - lastLatencyLogAt > 1000) {
      lastLatencyLogAt = lastPaintAt;
      latencyDroppedSinceLastSummary = 0;
    }
    if (p.frameId > 0) ackCameraFrame(p.frameId);
  });
}

function subscribeIpcOnce() {
  if (ipcSubscribed) return;
  ipcSubscribed = true;
  window.api.on('camera:frame', (meta: CameraFrameMeta, body: ArrayBufferLike) => {
    const receivedAt = Date.now();
    lastFrameAt = receivedAt;
    if (receivedAt - lastRendererRecvLogAt >= 5000) {
      lastRendererRecvLogAt = receivedAt;
    }
    frameIdCounter += 1;
    // Explicit type-and-value check: `meta.frameId ?? counter` falls through
    // on null/undefined only, NOT on the integer 0. If main ever sent 0 (or
    // any non-positive), we'd silently keep using it. Same idea for the seq
    // backup — it should never be 0 once the SDK has streamed at least one
    // frame, but guard anyway.
    const metaIdRaw = (meta as { frameId?: unknown }).frameId;
    const metaId = typeof metaIdRaw === 'number' && metaIdRaw > 0 ? metaIdRaw : 0;
    const frameId = metaId > 0 ? metaId : frameIdCounter;
    if (metaId > 0) frameIdCounter = Math.max(frameIdCounter, metaId);
    const grabTs = meta.grabTs ?? meta.capturedAt ?? 0;
    if (meta.droppedBeforeSend && meta.droppedBeforeSend > 0) {
      latencyDroppedSinceLastSummary += meta.droppedBeforeSend;
    }
    // Objective-change guard: drop frames captured before the most recent
    // objective swap — they are SDK-buffered pixels of the previous lens.
    const frameTs = grabTs || meta.capturedAt || 0;
    if (staleFramesBeforeTs > 0 && frameTs > 0 && frameTs < staleFramesBeforeTs) {
      recordCameraFrameDrop('pre-change-frame', frameId, receivedAt - frameTs);
      // Still ack so main releases its in-flight slot.
      ackCameraFrame(frameId);
      return;
    }
    // We deliberately do NOT drop on `frameId < latestFrameIdRef.current`.
    // The SDK frame counter resets on stream restarts (setExposure /
    // setGain / setLiveMode / objective change). After a reset, frameId
    // legitimately drops back to 1, 2, 3… and dropping those would blank
    // the live view forever. Wall-clock age is the only stale authority;
    // the gate just below handles that. Same rationale as cameraService.
    if (frameId > latestFrameIdRef.current) {
      latestFrameIdRef.current = frameId;
    } else {
      // Counter regression — treat as a reset and re-anchor.
      latestFrameIdRef.current = frameId;
    }
    latestFrameRef.current = { meta, body, frameId, receivedAt };
    // Hold the FULL-resolution raw IPC body in renderer memory BEFORE the
    // live-stale gate. Auto Measure clicks read latestFullFrame synchronously;
    // even a "stale for live preview" frame is still a valid measurement
    // snapshot (the user's click is the freeze point, not the live paint).
    latestFullFrame = {
      body,
      width: meta.width,
      height: meta.height,
      pixelFormat: meta.pixelFormat,
      bits: meta.bits,
      capturedAt: meta.capturedAt ?? receivedAt,
      grabTs: meta.grabTs,
      frameId,
    };
    // Age gate for the LIVE paint path only. By the time IPC delivered this
    // frame, the machine may have moved further — never paint stale pixels
    // to the live canvas. Ack so main releases its in-flight slot, and let
    // a fresher frame from native drive the next paint.
    if (grabTs > 0) {
      const ageMs = receivedAt - grabTs;
      if (ageMs > STALE_AGE_MS) {
        recordCameraFrameDrop('over-100ms-before-renderer', frameId, ageMs);
        ackCameraFrame(frameId);
        return;
      }
    }
    if (!firstFrameLoggedThisSession) {
      firstFrameLoggedThisSession = true;
    }
    // Latest-frame-only policy: if the worker is still decoding a previous
    // frame, replace any pending frame with this one and drop the older
    // pending. This bounds the queue to 1 in-flight + 1 pending and keeps
    // the visible canvas tracking the freshest physical state of the machine.
    if (decoderBusy) {
      if (pendingFrame) {
        recordCameraFrameDrop('pending-frame-overwrite', pendingFrame.frameId);
        // Older pending will never reach decode/paint — ack so main process
        // doesn't keep it in flight forever.
        ackCameraFrame(pendingFrame.frameId);
      }
      pendingFrame = { meta, body, frameId, receivedAt };
      return;
    }
    postFrameToWorker(meta, body, frameId);
  });
}

function flushPendingFrame() {
  if (!pendingFrame || decoderBusy) return;
  const { meta, body, frameId } = pendingFrame;
  pendingFrame = null;
  // No frameId<latest drop here either — SDK counter resets are legitimate.
  postFrameToWorker(meta, body, frameId);
}

export function resetCameraSession() {
  firstFrameLoggedThisSession = false;
  firstPaintLoggedThisSession = false;
  latestFrameRef.current = null;
  latestFrameIdRef.current = 0;
  pendingFrame = null;
  pendingPaint = null;
  decoderBusy = false;
  staleFramesBeforeTs = 0;
  lastLatencyLogAt = 0;
  latencyDroppedSinceLastSummary = 0;
  getWorker().postMessage({ type: 'clear-queue', epoch: frameEpoch, reason: 'session-reset' });
}

function toArrayBuffer(body: ArrayBufferLike): ArrayBuffer {
  if (body instanceof ArrayBuffer) return body;
  const u8 = body as unknown as Uint8Array;
  return u8.slice().buffer as ArrayBuffer;
}

function postFrameToWorker(meta: CameraFrameMeta, body: ArrayBufferLike, frameId: number) {
  // (No frameId<latest drop — SDK counter resets on stream restarts.)
  const worker = getWorker();
  const ab = toArrayBuffer(body);
  decoderBusy = true;
  // Track capture time end-to-end (main-process capturedAt is the most
  // authoritative reference for totalMs — closer to the native callback
  // than anything we can measure in the renderer).
  inFlightCapturedAt = meta.capturedAt ?? Date.now();
  inFlightGrabTs = meta.grabTs ?? inFlightCapturedAt;
  inFlightFrameId = frameId;
  const nowPost = Date.now();
  if (nowPost - lastWorkerRecvLogAt >= 5000) {
    lastWorkerRecvLogAt = nowPost;
  }
  worker.postMessage(
    {
      type: 'frame',
      buffer: ab,
      width: meta.width,
      height: meta.height,
      pixelFormat: meta.pixelFormat,
      bits: meta.bits,
      epoch: frameEpoch,
      seq: meta.seq,
      frameId,
      previewScale: PREVIEW_SCALE,
    },
    [ab]
  );
}

export function getLastCameraFrameAt(): number {
  return lastFrameAt;
}

export function getLastCameraFramePaintAt(): number {
  return lastPaintAt;
}

export function getCurrentFrameEpoch(): number {
  return frameEpoch;
}

export function getLastPaintEpoch(): number {
  return lastPaintEpoch;
}

export function getLastPaintedFrameId(): number {
  return lastPaintedFrameId;
}

export function dropPendingCameraFrames(reason = 'stale'): number {
  const ts = Date.now();
  let dropped = 0;
  staleFramesBeforeTs = ts;
  latestFrameRef.current = null;
  if (pendingFrame) {
    recordCameraFrameDrop(reason, pendingFrame.frameId);
    ackCameraFrame(pendingFrame.frameId);
    pendingFrame = null;
    dropped += 1;
  }
  if (pendingPaint) {
    recordCameraFrameDrop(reason, pendingPaint.frameId);
    ackCameraFrame(pendingPaint.frameId);
    pendingPaint = null;
    dropped += 1;
  }
  if (inFlightFrameId > 0) {
    ackCameraFrame(inFlightFrameId);
    inFlightFrameId = 0;
    inFlightGrabTs = 0;
    inFlightCapturedAt = 0;
  }
  decoderBusy = false;
  getWorker().postMessage({ type: 'clear-queue', epoch: frameEpoch, reason });
  return ts;
}

/**
 * Bumps the frame epoch and resets paint tracking. Call this immediately
 * AFTER clearing the live canvas (objective change). Effect:
 *   - Any frame already queued in the worker, decoded but not yet painted,
 *     is dropped on arrival (epoch mismatch) instead of overwriting the
 *     freshly cleared canvas.
 *   - waitForFreshCameraFrame / capture guards now require a paint whose
 *     epoch matches the new value, i.e. a frame that was received AFTER
 *     the clear and successfully painted.
 */
export function bumpFrameEpochOnCanvasClear(): number {
  frameEpoch += 1;
  dropPendingCameraFrames('objective-change');
  // Ask main process to drop SDK-buffered frames captured before this point.
  flushCameraStream('objective-change');
  // lastPaintAt deliberately NOT zeroed — guards compare lastPaintEpoch,
  // not lastPaintAt, to decide if a fresh post-clear paint has landed.
  return frameEpoch;
}

export function waitForFreshCameraFrame(timeoutMs = 1500): Promise<boolean> {
  const startedAt = Date.now();
  const targetEpoch = frameEpoch;
  const baselinePaint = lastPaintAt;
  return new Promise<boolean>((resolve) => {
    const tick = () => {
      // Fresh = a paint at the current epoch that landed after we started
      // waiting. Both conditions matter: epoch guards against pre-clear
      // pixels; baselinePaint guards against an old paint that already
      // happened before this call.
      if (lastPaintEpoch >= targetEpoch && lastPaintAt > baselinePaint) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 30);
    };
    tick();
  });
}

export function useCameraStream() {
  const attachOnceRef = useRef(false);

  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => {
    if (!el) return;
    if (attached && attached.el === el) return;
    if (attached && attached.el !== el) {
      // A different canvas mounted (route change, etc.). The previous canvas
      // was already transferred and cannot be reused; we just rebind to the
      // new one in 2D-fallback mode.
      attached = { el, fallbackCtx: el.getContext('2d') };
      installMainThreadPaintHandler();
      getWorker().postMessage({ type: 'init-2d' });
      return;
    }

    const worker = getWorker();
    // OffscreenCanvas presentation has been flaky in Electron dev (esp. with
    // DevTools' Responsive Mode), producing a black canvas even though the
    // worker successfully puts pixels into the offscreen bitmap. The 2D
    // fallback path is just as fast for this workload (transferable
    // ImageData postMessage is zero-copy) and renders reliably.
    const supportsOffscreen = false;

    if (supportsOffscreen) {
      const offscreen = (el as unknown as {
        transferControlToOffscreen: () => OffscreenCanvas;
      }).transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen as unknown as Transferable]);
      attached = { el, fallbackCtx: null };
    } else {
      installMainThreadPaintHandler();
      worker.postMessage({ type: 'init-2d' });
      attached = { el, fallbackCtx: el.getContext('2d') };
    }
  }, []);

  useEffect(() => {
    subscribeIpcOnce();
    if (attachOnceRef.current) return;
    attachOnceRef.current = true;
  }, []);

  return { attachCanvas };
}
