import { useCallback, useEffect, useRef } from 'react';
import CameraStreamWorker from '@/workers/cameraStream.worker.ts?worker';
import { getCameraFrame } from '@/api/getCameraFrame';
import type { CameraFrameMeta } from '@/types/camera';

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
let liveFrameLogSeq = 0;
let lastLiveFrameOverlayLogAt = 0;
let fallbackTimer: number | null = null;
let fallbackInFlight = false;
// Reset by resetCameraSession() on close so the next open re-fires the
// first-frame / first-paint logs. The IPC subscription itself stays attached
// for the page lifetime — only the per-session telemetry is reset.
let firstFrameLoggedThisSession = false;
let firstPaintLoggedThisSession = false;

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
    (e: MessageEvent<{ type: string; imageData?: ImageData; epoch?: number; seq?: number }>) => {
      if (!e.data || e.data.type !== 'paint' || !e.data.imageData) return;
      const paintEpoch = typeof e.data.epoch === 'number' ? e.data.epoch : 0;
      // Drop paints from a frame received before the latest canvas clear —
      // those pixels belong to the previous objective and would re-pollute
      // the freshly-cleared canvas.
      if (paintEpoch < frameEpoch) {
        // eslint-disable-next-line no-console
        console.log(
          `[camera-frame-drop] reason=stale-epoch paintEpoch=${paintEpoch} currentEpoch=${frameEpoch} seq=${e.data.seq ?? 'n/a'}`
        );
        return;
      }
      if (!attached || !attached.fallbackCtx) return;
      const { el, fallbackCtx } = attached;
      const img = e.data.imageData;
      if (el.width !== img.width || el.height !== img.height) {
        el.width = img.width;
        el.height = img.height;
      }
      fallbackCtx.putImageData(img, 0, 0);
      lastPaintAt = Date.now();
      lastPaintEpoch = paintEpoch;
      if (!firstPaintLoggedThisSession) {
        firstPaintLoggedThisSession = true;
        // eslint-disable-next-line no-console
        console.log('[camera-ui] first-paint-after-open ok=true');
      }
    }
  );
}

function subscribeIpcOnce() {
  if (ipcSubscribed) return;
  ipcSubscribed = true;
  window.api.on('camera:frame', (meta: CameraFrameMeta, body: ArrayBufferLike) => {
    lastFrameAt = Date.now();
    liveFrameLogSeq += 1;
    if (!firstFrameLoggedThisSession) {
      firstFrameLoggedThisSession = true;
      const bytes = (body as { byteLength?: number }).byteLength ?? 0;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-frame] first-frame-after-open width=${meta.width} height=${meta.height} bytes=${bytes}`
      );
    }
    if (lastFrameAt - lastLiveFrameOverlayLogAt > 1000) {
      lastLiveFrameOverlayLogAt = lastFrameAt;
      // eslint-disable-next-line no-console
      console.log(`[live-frame] frameId=${liveFrameLogSeq} overlayUnchanged=true`);
    }
    postFrameToWorker(meta, body);
  });
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

function postFrameToWorker(meta: CameraFrameMeta, body: ArrayBufferLike) {
  const worker = getWorker();
  const ab = toArrayBuffer(body);
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
          reply.data
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
