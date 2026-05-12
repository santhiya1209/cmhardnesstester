import { useCallback, useEffect, useRef } from 'react';
import CameraStreamWorker from '@/workers/cameraStream.worker.ts?worker';
import { getCameraFrame } from '@/api/getCameraFrame';
import { ackCameraFrame } from '@/api/ackCameraFrame';
import { flushCameraStream } from '@/api/flushCameraStream';
import type { CameraFrameMeta, CameraPixelFormat } from '@/types/camera';

// Live-preview subsample factor. The worker decodes a (W/SCALE)×(H/SCALE)
// RGBA ImageData instead of the full sensor resolution. For a 2592×1944 mono8
// source, scale=2 drops conversion work + transfer from 20MB to 5MB. Auto
// Measure does NOT use the downscaled output — it reads the full-resolution
// raw buffer kept in `latestFullFrame` via getLatestFullFrame(). To change the
// preview resolution, edit this constant — must be an integer ≥1.
const PREVIEW_SCALE = 2;

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
let liveFrameLogSeq = 0;
let lastLiveFrameOverlayLogAt = 0;
// Latest-frame-only backpressure. The worker decodes serially; without this,
// frames pile up in its message-port queue and the user sees a delayed replay
// of physical machine movement. Policy: at most ONE frame in-flight in the
// worker + ONE pending frame on the main thread. A newer frame replaces the
// pending one (older queued frames are dropped). The worker's 'paint' echo is
// the "decoder idle" signal that flushes the pending frame.
let decoderBusy = false;
let pendingFrame: { meta: CameraFrameMeta; body: ArrayBufferLike; frameId: number } | null = null;
let inFlightCapturedAt = 0;
let inFlightFrameId = 0;
let inFlightSentAt = 0;
let inFlightReceivedAt = 0;
let inFlightPostedAt = 0;
let frameIdCounter = 0;
let lastLatencyLogAt = 0;
let objectiveChangedAt = 0;
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
} | null = null;
let rafScheduled = false;
let fallbackTimer: number | null = null;
let fallbackInFlight = false;
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
} | null = null;

export function getLatestFullFrame() {
  return latestFullFrame;
}

function getWorker(): Worker {
  if (!sharedWorker) sharedWorker = new CameraStreamWorker();
  return sharedWorker;
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
        // eslint-disable-next-line no-console
        console.log(
          `[camera-frame-drop] reason=stale-epoch paintEpoch=${paintEpoch} currentEpoch=${frameEpoch} seq=${e.data.seq ?? 'n/a'}`
        );
        decoderBusy = false;
        // Still ack so main process releases its slot — the frame was
        // delivered + decoded; main shouldn't be stuck waiting.
        if (inFlightFrameId > 0) ackCameraFrame(inFlightFrameId);
        flushPendingFrame();
        return;
      }
      // Stash latest decoded image; rAF coalesces multiple paints into one
      // putImageData per frame. If a newer paint arrives before rAF fires,
      // it replaces this one — the older pixels never touch the canvas.
      if (pendingPaint) {
        // eslint-disable-next-line no-console
        console.log(
          `[camera-frame-drop] frameId=${pendingPaint.frameId} reason=newer-frame-available`
        );
      }
      pendingPaint = {
        imageData: e.data.imageData,
        epoch: paintEpoch,
        seq: e.data.seq ?? 0,
        frameId: resolvedFrameId,
        capturedAt: inFlightCapturedAt,
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
    const drawStart = performance.now();
    fallbackCtx.putImageData(img, 0, 0);
    const drawMs = Math.round(performance.now() - drawStart);
    lastPaintAt = Date.now();
    lastPaintEpoch = p.epoch;
    lastPaintedFrameId = p.frameId;
    if (!firstPaintLoggedThisSession) {
      firstPaintLoggedThisSession = true;
      // eslint-disable-next-line no-console
      console.log('[camera-ui] first-paint-after-open ok=true');
    }
    const totalMs = p.capturedAt > 0 ? lastPaintAt - p.capturedAt : 0;
    const slow = totalMs > 50;
    // Always log slow frames so a stage-move event surfaces every offending
    // frame, not the throttled 1Hz sample. Fast frames still throttle to 1Hz
    // to keep the log readable.
    if (slow || lastPaintAt - lastLatencyLogAt > 1000) {
      lastLatencyLogAt = lastPaintAt;
      const sendToRendererMs =
        inFlightSentAt > 0 && inFlightReceivedAt > 0
          ? inFlightReceivedAt - inFlightSentAt
          : 0;
      const rendererQueueMs =
        inFlightReceivedAt > 0 && inFlightPostedAt > 0
          ? inFlightPostedAt - inFlightReceivedAt
          : 0;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-latency] frameId=${p.frameId} sendToRendererMs=${sendToRendererMs} rendererQueueMs=${rendererQueueMs} drawMs=${drawMs} totalMs=${totalMs}${slow ? ' SLOW' : ''}`
      );
      // eslint-disable-next-line no-console
      console.log(`[camera-frame-render] frameId=${p.frameId} latencyMs=${totalMs}`);
      // eslint-disable-next-line no-console
      console.log(`[camera-latency-total] frameId=${p.frameId} totalMs=${totalMs}${slow ? ' SLOW' : ''}`);
    }
    if (p.frameId > 0) ackCameraFrame(p.frameId);
  });
}

function subscribeIpcOnce() {
  if (ipcSubscribed) return;
  ipcSubscribed = true;
  // eslint-disable-next-line no-console
  console.log('[camera-render-mode] latest-frame-only=true');
  window.api.on('camera:frame', (meta: CameraFrameMeta, body: ArrayBufferLike) => {
    const receivedAt = Date.now();
    lastFrameAt = receivedAt;
    liveFrameLogSeq += 1;
    frameIdCounter += 1;
    // Explicit type-and-value check: `meta.frameId ?? counter` falls through
    // on null/undefined only, NOT on the integer 0. If main ever sent 0 (or
    // any non-positive), we'd silently keep using it. Same idea for the seq
    // backup — it should never be 0 once the SDK has streamed at least one
    // frame, but guard anyway.
    const metaIdRaw = (meta as { frameId?: unknown }).frameId;
    const metaId = typeof metaIdRaw === 'number' && metaIdRaw > 0 ? metaIdRaw : 0;
    const frameId = metaId > 0 ? metaId : frameIdCounter;
    // Hold the FULL-resolution raw IPC body in renderer memory. The body is a
    // Buffer (Uint8Array view) that was structured-cloned into the renderer
    // by Electron — it owns its backing store and is GC'd independently of
    // the worker-transferred slice. Auto Measure reads from here, NOT the
    // visible canvas (which the worker now paints at PREVIEW_SCALE).
    latestFullFrame = {
      body,
      width: meta.width,
      height: meta.height,
      pixelFormat: meta.pixelFormat,
      bits: meta.bits,
      capturedAt: meta.capturedAt ?? receivedAt,
    };
    if (!firstFrameLoggedThisSession) {
      firstFrameLoggedThisSession = true;
      const bytes = (body as { byteLength?: number }).byteLength ?? 0;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-frame] first-frame-after-open width=${meta.width} height=${meta.height} bytes=${bytes}`
      );
    }
    // Objective-change guard: drop frames captured before the most recent
    // objective swap — they are SDK-buffered pixels of the previous lens.
    const capturedAt = meta.capturedAt ?? 0;
    if (objectiveChangedAt > 0 && capturedAt > 0 && capturedAt < objectiveChangedAt) {
      // eslint-disable-next-line no-console
      console.log(
        `[camera-frame-drop] frameId=${frameId} reason=stale-pre-objective-change capturedAt=${capturedAt} objectiveChangedAt=${objectiveChangedAt}`
      );
      // Still ack so main releases its in-flight slot.
      ackCameraFrame(frameId);
      return;
    }
    if (lastFrameAt - lastLiveFrameOverlayLogAt > 1000) {
      lastLiveFrameOverlayLogAt = lastFrameAt;
      // eslint-disable-next-line no-console
      console.log(`[live-frame] frameId=${liveFrameLogSeq} overlayUnchanged=true`);
      const sentAt = meta.sentAt ?? 0;
      // eslint-disable-next-line no-console
      console.log(`[camera-frame-recv] frameId=${frameId} ts=${receivedAt}`);
      // eslint-disable-next-line no-console
      console.log(
        `[camera-frame-recv-detail] frameId=${frameId} timestamp=${meta.timestamp} sentAt=${sentAt} receivedAt=${receivedAt}`
      );
      if (sentAt > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[camera-latency] frameId=${frameId} sendToRendererMs=${receivedAt - sentAt}`
        );
      }
      // eslint-disable-next-line no-console
      console.log(`[camera-queue] size=${pendingFrame ? 1 : 0}`);
    }
    // Latest-frame-only policy: if the worker is still decoding a previous
    // frame, replace any pending frame with this one and drop the older
    // pending. This bounds the queue to 1 in-flight + 1 pending and keeps
    // the visible canvas tracking the freshest physical state of the machine.
    if (decoderBusy) {
      if (pendingFrame) {
        // eslint-disable-next-line no-console
        console.log(`[camera-frame-drop] frameId=${pendingFrame.frameId} reason=newer-frame-available`);
        // Older pending will never reach decode/paint — ack so main process
        // doesn't keep it in flight forever.
        ackCameraFrame(pendingFrame.frameId);
      }
      pendingFrame = { meta, body, frameId };
      // Stash receivedAt on the held frame so we can measure rendererQueueMs
      // accurately when it finally posts.
      (pendingFrame as unknown as { receivedAt: number }).receivedAt = receivedAt;
      return;
    }
    inFlightReceivedAt = receivedAt;
    postFrameToWorker(meta, body, frameId);
  });
}

function flushPendingFrame() {
  if (!pendingFrame || decoderBusy) return;
  const held = pendingFrame as unknown as { receivedAt: number };
  if (held.receivedAt) inFlightReceivedAt = held.receivedAt;
  const { meta, body, frameId } = pendingFrame;
  pendingFrame = null;
  postFrameToWorker(meta, body, frameId);
}

export function resetCameraSession() {
  firstFrameLoggedThisSession = false;
  firstPaintLoggedThisSession = false;
}

function toArrayBuffer(body: ArrayBufferLike): ArrayBuffer {
  if (body instanceof ArrayBuffer) return body;
  const u8 = body as unknown as Uint8Array;
  return u8.slice().buffer as ArrayBuffer;
}

function postFrameToWorker(meta: CameraFrameMeta, body: ArrayBufferLike, frameId: number) {
  const worker = getWorker();
  const copyStart = performance.now();
  const ab = toArrayBuffer(body);
  const copyMs = performance.now() - copyStart;
  // Surface the renderer-side copy cost. toArrayBuffer slices if `body` is a
  // Uint8Array view (it is — main forwards an owned Buffer), which is a third
  // full-image memcpy on the JS thread. Logged at 1Hz to keep noise down.
  if (copyMs > 2 || (frameId && frameId % 60 === 0)) {
    // eslint-disable-next-line no-console
    console.log(
      `[camera-renderer-copy] frameId=${frameId} copyMs=${copyMs.toFixed(2)} bytes=${ab.byteLength}`
    );
  }
  decoderBusy = true;
  // Track capture time end-to-end (main-process capturedAt is the most
  // authoritative reference for totalMs — closer to the native callback
  // than anything we can measure in the renderer).
  inFlightCapturedAt = meta.capturedAt ?? Date.now();
  inFlightSentAt = meta.sentAt ?? 0;
  inFlightFrameId = frameId;
  inFlightPostedAt = Date.now();
  if (frameId && frameId % 60 === 0) {
    // eslint-disable-next-line no-console
    console.log(`[camera-frame-send] frameId=${frameId} timestamp=${meta.timestamp}`);
    // eslint-disable-next-line no-console
    console.log(`[camera-queue] size=${pendingFrame ? 1 : 0}`);
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

function startSnapshotFallback() {
  if (fallbackTimer !== null) return;
  fallbackTimer = window.setInterval(() => {
    if (!attached || fallbackInFlight) return;
    if (Date.now() - lastFrameAt < 1500) return;
    fallbackInFlight = true;
    void getCameraFrame(1000)
      .then((reply) => {
        if (
          !reply.ok ||
          !reply.data ||
          typeof reply.width !== 'number' ||
          typeof reply.height !== 'number' ||
          !reply.pixelFormat ||
          (reply.bits !== 8 && reply.bits !== 16) ||
          typeof reply.timestamp !== 'number' ||
          typeof reply.seq !== 'number' ||
          typeof reply.bytes !== 'number'
        ) {
          return;
        }
        lastFrameAt = Date.now();
        // Snapshot fallback has no main-process frameId — assign one from the
        // shared counter so logs still show a monotonic value (never 0).
        frameIdCounter += 1;
        postFrameToWorker(
          {
            width: reply.width,
            height: reply.height,
            pixelFormat: reply.pixelFormat,
            bits: reply.bits,
            timestamp: reply.timestamp,
            seq: reply.seq,
            bytes: reply.bytes,
          },
          reply.data,
          frameIdCounter
        );
      })
      .catch(() => {
        // Live stream events may resume; keep the fallback quiet.
      })
      .finally(() => {
        fallbackInFlight = false;
      });
  }, 1000);
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
  objectiveChangedAt = Date.now();
  // Drop any frame that was queued behind the in-flight decode but had not
  // been posted yet — it was captured before the canvas clear and would
  // repaint stale pixels of the previous objective. The in-flight frame
  // itself is tagged with the old epoch (assigned at post time) and is
  // already dropped by the paintEpoch < frameEpoch guard.
  if (pendingFrame) {
    // eslint-disable-next-line no-console
    console.log(`[camera-frame-drop] frameId=${pendingFrame.frameId} reason=stale`);
    pendingFrame = null;
  }
  // Drop any pending paint too — it was decoded from a pre-clear frame.
  if (pendingPaint) {
    // eslint-disable-next-line no-console
    console.log(`[camera-frame-drop] frameId=${pendingPaint.frameId} reason=stale-epoch-paint`);
    pendingPaint = null;
  }
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
    startSnapshotFallback();
  }, []);

  useEffect(() => {
    subscribeIpcOnce();
    if (attachOnceRef.current) return;
    attachOnceRef.current = true;
  }, []);

  return { attachCanvas };
}
