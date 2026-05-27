import { useCallback, useEffect, useRef } from 'react';
import CameraStreamWorker from '@/workers/cameraStream.worker.ts?worker';
import { ackCameraFrame } from '@/api/camera';
import { flushCameraStream } from '@/api/camera';
import type { CameraFrameMeta, CameraPixelFormat } from '@/types/camera';

// Live-preview subsample factor — affects the DISPLAY path ONLY.
//
//   2 = the worker decodes the native frame down to half width/height
//   (2592×1944 → 1296×972) for the live canvas. That is ¼ the decode work,
//   ¼ the worker→main ImageData transfer (~5MB vs ~20MB), and ¼ the
//   main-thread putImageData cost per frame — the direct fix for the
//   over-250ms-before-draw bursts at full res. 1296×972 is still LARGER than
//   the canvas's CSS box (~1021×675), so with imageRendering:auto the preview
//   stays crisp (it is downscaled, never upscaled). Going to 3 (864 wide)
//   would drop below the display box and soften the image — 2 is the sweet
//   spot.
//
// Measurement is UNAFFECTED: Auto/Manual measure, freeze-capture, and export
// all read the full-resolution raw IPC buffer (latestFullFrame via
// getLatestFullFrame), which is stored before the worker decode and never
// subsampled. This constant only changes the live-preview bitmap. Integer ≥1.
const PREVIEW_SCALE = 2;

// Stale-frame age threshold (grab→renderer-receive). A frame whose grab
// timestamp is older than this is dropped at both the renderer-inbound gate
// and the paint-time gate so the live canvas never shows pixels that lag the
// physical machine. Set to 250ms: a 100ms gate dropped frames in bursts while
// the operator turned the focus knob (fast scene change + decode backlog),
// which froze the preview and then snapped forward when one finally survived.
// 250ms keeps continuity during focusing while still discarding genuinely
// stale frames — a quarter-second is the most lag we tolerate on the live
// view. This is the live-preview gate only; it does not affect the full-res
// frame held for measurement.
const STALE_AGE_MS = 250;

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
// Paint-lifecycle counters, flushed once per second by maybeLogPaintLifecycle()
// — NOT per frame (per CLAUDE.md: no per-frame logging). Let the operator see
// how many decoded frames got queued for paint vs skipped (stale/superseded)
// vs actually painted, without log spam.
let paintQueuedSinceLog = 0;
let paintSkippedSinceLog = 0;
let paintFinishedSinceLog = 0;
let lastLifecycleLogAt = 0;
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
// Render-path identity log, emitted once per app lifetime (not per session).
// Records that the active render path is the worker-decode → transferable
// ImageData → main-thread putImageData path (the OffscreenCanvas path was
// removed — see attachCanvas).
let renderPathLogged = false;
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

let firstDropLogged = false;
function recordCameraFrameDrop(reason = 'stale', frameId = 0, ageMs = 0): void {
  latencyDroppedSinceLastSummary += 1;
  if (!firstDropLogged) {
    firstDropLogged = true;
    // eslint-disable-next-line no-console
    console.log(
      `[camera-render-blocked-check] first-drop reason=${reason} frameId=${frameId} ageMs=${ageMs}`
    );
    // Surface stale/over-threshold drops under the latency namespace too
    // (first occurrence per session/boundary — re-armed when firstDropLogged
    // resets, never per-frame).
    if (reason.includes('over-') || reason.includes('stale')) {
      // eslint-disable-next-line no-console
      console.log(
        `[camera-render-latency][stale-frame-drop] reason=${reason} frameId=${frameId} ageMs=${ageMs}`
      );
    }
  }
}

// Flush the paint-lifecycle counters at most once per second. Called from the
// worker 'paint' handler (which fires for every decoded frame while streaming,
// so the summary still emits during a drop storm when no frame paints).
function maybeLogPaintLifecycle(): void {
  const now = Date.now();
  if (now - lastLifecycleLogAt < 1000) return;
  lastLifecycleLogAt = now;
  // eslint-disable-next-line no-console
  console.log(`[camera-render-latency][paint-queued] count1s=${paintQueuedSinceLog}`);
  // eslint-disable-next-line no-console
  console.log(`[camera-render-latency][paint-skipped] count1s=${paintSkippedSinceLog}`);
  // eslint-disable-next-line no-console
  console.log(`[camera-render-latency][paint-finished] count1s=${paintFinishedSinceLog}`);
  paintQueuedSinceLog = 0;
  paintSkippedSinceLog = 0;
  paintFinishedSinceLog = 0;
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
        paintSkippedSinceLog += 1;
        decoderBusy = false;
        // Still ack so main process releases its slot — the frame was
        // delivered + decoded; main shouldn't be stuck waiting.
        if (resolvedFrameId > 0) ackCameraFrame(resolvedFrameId);
        flushPendingFrame();
        maybeLogPaintLifecycle();
        return;
      }
      // Stale-before-stash: if the frame is already older than the threshold
      // when the worker finishes decoding it (slow decode, or the main thread
      // ran long on the previous tick), don't stash it or schedule an rAF the
      // rAF would only drop. Discarding here — one step earlier than the
      // rAF-time gate — avoids a doomed putImageData attempt during a stall, so
      // the main thread recovers faster. Ack at idle + flush as usual.
      const ageAtStash = inFlightGrabTs > 0 ? Date.now() - inFlightGrabTs : 0;
      if (ageAtStash > STALE_AGE_MS) {
        recordCameraFrameDrop('stale-before-stash', resolvedFrameId, ageAtStash);
        paintSkippedSinceLog += 1;
        decoderBusy = false;
        if (resolvedFrameId > 0) ackCameraFrame(resolvedFrameId);
        flushPendingFrame();
        maybeLogPaintLifecycle();
        return;
      }
      // (Previously dropped on `resolvedFrameId < latestFrameIdRef`, but
      // the SDK frame counter can reset on stream restarts, so that gate
      // would blank the live view post-restart. Removed — the wall-clock
      // age gate in schedulePaintRaf is the sole stale authority.)
      // Stash latest decoded image; rAF coalesces multiple paints into one
      // putImageData per frame. If a newer paint arrives before rAF fires,
      // it replaces this one — the older pixels never touch the canvas.
      if (pendingPaint) {
        // The superseded paint was already acked to main at worker-idle (when
        // it was stashed). Latest-frame-wins: its pixels never reach the canvas
        // — just record the drop, do NOT re-ack.
        recordCameraFrameDrop('pending-paint-overwrite', pendingPaint.frameId);
        paintSkippedSinceLog += 1;
      }
      pendingPaint = {
        imageData: e.data.imageData,
        epoch: paintEpoch,
        seq: e.data.seq ?? 0,
        frameId: resolvedFrameId,
        capturedAt: inFlightCapturedAt,
        grabTs: inFlightGrabTs,
      };
      paintQueuedSinceLog += 1;
      decoderBusy = false;
      // Backpressure ack at WORKER-IDLE — not after the rAF putImageData. The
      // worker is free the instant it posts 'paint', so acking here lets the
      // main process drain its newest pending frame and start the next IPC +
      // decode immediately, overlapping it (worker thread) with this frame's
      // putImageData (main thread, in rAF below). Previously the ack waited
      // until after putImageData, so the decode pipeline sat idle for a full
      // main↔renderer round-trip every frame — the source of the latency
      // bursts. The rAF below is display-only and never re-acks.
      if (resolvedFrameId > 0) ackCameraFrame(resolvedFrameId);
      flushPendingFrame();
      schedulePaintRaf();
      maybeLogPaintLifecycle();
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
      // Already acked at worker-idle; rAF only decides whether to display.
      recordCameraFrameDrop('pre-change-frame', p.frameId, Date.now() - p.grabTs);
      paintSkippedSinceLog += 1;
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
        recordCameraFrameDrop(`over-${STALE_AGE_MS}ms-before-draw`, p.frameId, ageAtPaint);
        paintSkippedSinceLog += 1;
        return;
      }
    }
    if (!attached || !attached.fallbackCtx) {
      paintSkippedSinceLog += 1;
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
    paintFinishedSinceLog += 1;
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
      // eslint-disable-next-line no-console
      console.log(`[camera-canvas-paint-check] first-paint frameId=${p.frameId}`);
      // eslint-disable-next-line no-console
      console.log(`[camera-render-path][canvas-first-paint] frameId=${p.frameId}`);
      // One-shot clarity diagnostics: source (intrinsic canvas) resolution vs
      // the CSS box it is scaled into. If canvas px >> css px the frame is
      // being downscaled by CSS; smooth (imageRendering:auto) sampling keeps
      // that downscale clear.
      // eslint-disable-next-line no-console
      console.log(`[camera-canvas][source-resolution] ${img.width}x${img.height}`);
      // Preview vs measurement resolution proof: preview is subsampled by
      // PREVIEW_SCALE; measurement keeps the full raw frame.
      // eslint-disable-next-line no-console
      console.log(`[camera-preview][preview-scale] ${PREVIEW_SCALE}`);
      // eslint-disable-next-line no-console
      console.log(`[camera-preview][display-resolution] ${img.width}x${img.height}`);
      // eslint-disable-next-line no-console
      console.log(
        `[camera-preview][measurement-resolution] ${latestFullFrame ? `${latestFullFrame.width}x${latestFullFrame.height}` : 'n/a'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[camera-canvas][display-size] css=${el.clientWidth}x${el.clientHeight} ` +
          `canvas=${el.width}x${el.height} objectFit=contain imageRendering=auto`
      );
    }
    if (lastPaintAt - lastLatencyLogAt > 1000) {
      lastLatencyLogAt = lastPaintAt;
      // Throttled 1Hz: grab→pixels-on-canvas latency + drops in the last
      // second. The number the operator actually perceives as lag.
      // eslint-disable-next-line no-console
      console.log(
        `[camera-render-latency][before-draw] ageMs=${p.grabTs > 0 ? lastPaintAt - p.grabTs : 0} dropped1s=${latencyDroppedSinceLastSummary}`
      );
      latencyDroppedSinceLastSummary = 0;
    }
    // No ack here — the frame was acked to main at worker-idle (paint handler)
    // so the next frame's decode already started while this paint ran.
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
        recordCameraFrameDrop(`over-${STALE_AGE_MS}ms-before-renderer`, frameId, ageMs);
        ackCameraFrame(frameId);
        return;
      }
    }
    if (!firstFrameLoggedThisSession) {
      firstFrameLoggedThisSession = true;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-ipc-frame-check] first-ipc-frame frameId=${frameId} ${meta.width}x${meta.height} ageMs=${grabTs > 0 ? receivedAt - grabTs : 0}`
      );
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
  // Drop-before-decode: if this frame aged past the stale threshold while it
  // waited for the decoder to free up, decoding it (~20-30ms for a 5MP frame)
  // only to have the paint gate discard it afterward would deepen the backlog.
  // Drop it now so the decoder stays free for a current frame, and ack so the
  // main process releases its in-flight slot. The next fresh ingest drives the
  // next paint. (No frameId<latest drop — SDK counter resets are legitimate.)
  const grabTs = meta.grabTs ?? meta.capturedAt ?? 0;
  if (grabTs > 0 && Date.now() - grabTs > STALE_AGE_MS) {
    recordCameraFrameDrop('stale-before-decode', frameId, Date.now() - grabTs);
    if (frameId > 0) ackCameraFrame(frameId);
    return;
  }
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
  // Arm a stale cutoff at reset time so any frame grabbed before this point
  // (a prior session's SDK-buffered frames) is dropped at the cheap
  // pre-change-frame gate instead of trickling through the per-frame age gate.
  // Genuine post-open frames have a later grabTs and pass. This keeps the
  // first surviving frame fresh so first-ipc-frame / first-paint fire on a
  // recent frame, not a stale backlog frame.
  staleFramesBeforeTs = Date.now();
  inFlightFrameId = 0;
  inFlightGrabTs = 0;
  inFlightCapturedAt = 0;
  lastLatencyLogAt = 0;
  latencyDroppedSinceLastSummary = 0;
  paintQueuedSinceLog = 0;
  paintSkippedSinceLog = 0;
  paintFinishedSinceLog = 0;
  lastLifecycleLogAt = 0;
  getWorker().postMessage({ type: 'clear-queue', epoch: frameEpoch, reason: 'session-reset' });
  // Drop the backend SDK's buffered frames too — the worker clear above only
  // empties the renderer-side queue.
  flushCameraStream('session-reset');
}

function toArrayBuffer(body: ArrayBufferLike): ArrayBuffer {
  if (body instanceof ArrayBuffer) return body;
  const u8 = body as unknown as Uint8Array;
  return u8.slice().buffer as ArrayBuffer;
}

let resolutionLogged = false;

function postFrameToWorker(meta: CameraFrameMeta, body: ArrayBufferLike, frameId: number) {
  // (No frameId<latest drop — SDK counter resets on stream restarts.)
  const worker = getWorker();
  const ab = toArrayBuffer(body);
  if (!resolutionLogged && meta.width > 0 && meta.height > 0) {
    resolutionLogged = true;
    // eslint-disable-next-line no-console
    console.log(
      `[camera-stream][native-resolution] ${meta.width}x${meta.height} ` +
        `bytes=${ab.byteLength} pixelFormat=${meta.pixelFormat} bits=${meta.bits} ` +
        `previewScale=${PREVIEW_SCALE}`
    );
  }
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
    // eslint-disable-next-line no-console
    console.log(
      `[camera-frame-transfer] direction=renderer-to-worker frameId=${frameId} bytes=${ab.byteLength}`
    );
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
  // Re-arm only the per-boundary "first drop" diagnostic so we can see
  // whether frames get dropped after this boundary. The first-IPC-frame and
  // first-paint markers are SESSION-scoped (camera open) — they are reset
  // ONLY by resetCameraSession() on a real camera reopen, never on a
  // gain/exposure/objective boundary. Re-arming them here was making
  // "first-ipc-frame frameId=1 / first-paint frameId=1" repeat on every
  // settings change even though no reopen occurred.
  firstDropLogged = false;
  // eslint-disable-next-line no-console
  console.log(`[camera-render-blocked-check] boundary reason=${reason} ts=${ts}`);
  latestFrameRef.current = null;
  if (pendingFrame) {
    recordCameraFrameDrop(reason, pendingFrame.frameId);
    ackCameraFrame(pendingFrame.frameId);
    pendingFrame = null;
    dropped += 1;
  }
  if (pendingPaint) {
    // pendingPaint was already acked to main at worker-idle when it was
    // stashed — just discard the un-displayed pixels, do NOT re-ack.
    recordCameraFrameDrop(reason, pendingPaint.frameId);
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
    // Single render path: the worker decodes each frame and transfers the
    // ImageData back; the main thread blits it here with putImageData. This is
    // the only render path — the OffscreenCanvas path was REMOVED because in
    // this Electron version transferring control to the worker produced a
    // black canvas (pixels written to the offscreen bitmap never composited to
    // the visible canvas; re-enabling it in commit b5f7d37 darkened the live
    // preview). The 2D canvas is the render target, NOT a camera-source
    // fallback — the camera source is always the native IPC stream.
    // (Handles both first attach and a rebind to a different canvas element.)
    installMainThreadPaintHandler();
    attached = { el, fallbackCtx: el.getContext('2d') };
    if (!renderPathLogged) {
      renderPathLogged = true;
      // eslint-disable-next-line no-console
      console.log(
        '[camera-render-path][offscreen-disabled] OffscreenCanvas path removed (black-canvas in this Electron)'
      );
      // eslint-disable-next-line no-console
      console.log(
        '[camera-render-path][2d-fallback] worker-decode → transferable ImageData → main-thread putImageData (render path, not a camera-source fallback)'
      );
    }
  }, []);

  useEffect(() => {
    subscribeIpcOnce();
    if (attachOnceRef.current) return;
    attachOnceRef.current = true;
  }, []);

  return { attachCanvas };
}
