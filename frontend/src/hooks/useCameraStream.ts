import { useCallback, useEffect, useRef } from 'react';
import CameraStreamWorker from '@/workers/cameraStream.worker.ts?worker';
import { ackCameraFrame } from '@/api/camera';
import { flushCameraStream } from '@/api/camera';
import type { CameraFrameMeta, CameraPixelFormat } from '@/types/camera';

const PREVIEW_SCALE = 2;
const STALE_AGE_MS = 250;
const DECODE_WATCHDOG_MS = 1000;

let sharedWorker: Worker | null = null;
type AttachedRef = { el: HTMLCanvasElement; fallbackCtx: CanvasRenderingContext2D | null };
let attached: AttachedRef | null = null;
let ipcSubscribed = false;
let mainThreadPaintHandlerInstalled = false;
let lastFrameAt = 0;
let lastPaintAt = 0;
let frameEpoch = 0;
let lastPaintEpoch = 0;
let lastPaintedFrameId = 0;
type LiveFrame = {
  meta: CameraFrameMeta;
  body: ArrayBufferLike;
  frameId: number;
  receivedAt: number;
};

let decoderBusy = false;
let inFlightDecodeStartedAt = 0;
let pendingFrame: LiveFrame | null = null;
let inFlightCapturedAt = 0;
let inFlightFrameId = 0;
let inFlightGrabTs = 0;
let frameIdCounter = 0;
let staleFramesBeforeTs = 0;
let pendingPaint: {
  imageData: ImageData;
  epoch: number;
  frameId: number;
  grabTs: number;
} | null = null;
let rafScheduled = false;
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

function installMainThreadPaintHandler() {
  if (mainThreadPaintHandlerInstalled) return;
  mainThreadPaintHandlerInstalled = true;
  const worker = getWorker();
  worker.addEventListener(
    'message',
    (e: MessageEvent<{ type: string; imageData?: ImageData; epoch?: number; frameId?: number }>) => {
      if (!e.data || e.data.type !== 'paint' || !e.data.imageData) return;
      const paintEpoch = typeof e.data.epoch === 'number' ? e.data.epoch : 0;
      const echoedRaw = (e.data as { frameId?: unknown }).frameId;
      const echoedFrameId =
        typeof echoedRaw === 'number' && echoedRaw > 0 ? echoedRaw : 0;
      const resolvedFrameId =
        echoedFrameId > 0 ? echoedFrameId : inFlightFrameId;
      if (paintEpoch < frameEpoch) {
        decoderBusy = false;
        if (resolvedFrameId > 0) ackCameraFrame(resolvedFrameId);
        flushPendingFrame();
        return;
      }
      const ageAtStash = inFlightGrabTs > 0 ? Date.now() - inFlightGrabTs : 0;
      if (ageAtStash > STALE_AGE_MS) {
        decoderBusy = false;
        if (resolvedFrameId > 0) ackCameraFrame(resolvedFrameId);
        flushPendingFrame();
        return;
      }
      pendingPaint = {
        imageData: e.data.imageData,
        epoch: paintEpoch,
        frameId: resolvedFrameId,
        grabTs: inFlightGrabTs,
      };
      decoderBusy = false;
      inFlightDecodeStartedAt = 0;
      if (resolvedFrameId > 0) ackCameraFrame(resolvedFrameId);
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
      return;
    }
    if (p.grabTs > 0) {
      const ageAtPaint = Date.now() - p.grabTs;
      if (ageAtPaint > STALE_AGE_MS) {
        return;
      }
    }
    if (!attached || !attached.fallbackCtx) {
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
  });
}

function subscribeIpcOnce() {
  if (ipcSubscribed) return;
  ipcSubscribed = true;
  window.api.on('camera:frame', (meta: CameraFrameMeta, body: ArrayBufferLike) => {
    const receivedAt = Date.now();
    lastFrameAt = receivedAt;
    frameIdCounter += 1;
    const metaIdRaw = (meta as { frameId?: unknown }).frameId;
    const metaId = typeof metaIdRaw === 'number' && metaIdRaw > 0 ? metaIdRaw : 0;
    const frameId = metaId > 0 ? metaId : frameIdCounter;
    if (metaId > 0) frameIdCounter = Math.max(frameIdCounter, metaId);
    const grabTs = meta.grabTs ?? meta.capturedAt ?? 0;
    const frameTs = grabTs || meta.capturedAt || 0;
    if (staleFramesBeforeTs > 0 && frameTs > 0 && frameTs < staleFramesBeforeTs) {
      ackCameraFrame(frameId);
      return;
    }
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
    if (grabTs > 0) {
      const ageMs = receivedAt - grabTs;
      if (ageMs > STALE_AGE_MS) {
        ackCameraFrame(frameId);
        return;
      }
    }
    if (
      decoderBusy &&
      inFlightDecodeStartedAt > 0 &&
      receivedAt - inFlightDecodeStartedAt > DECODE_WATCHDOG_MS
    ) {
      if (inFlightFrameId > 0) ackCameraFrame(inFlightFrameId);
      decoderBusy = false;
      inFlightFrameId = 0;
      inFlightGrabTs = 0;
      inFlightCapturedAt = 0;
      inFlightDecodeStartedAt = 0;
    }
    if (decoderBusy) {
      if (pendingFrame) {
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
  const grabTs = meta.grabTs ?? meta.capturedAt ?? 0;
  if (grabTs > 0 && Date.now() - grabTs > STALE_AGE_MS) {
    if (frameId > 0) ackCameraFrame(frameId);
    return;
  }
  postFrameToWorker(meta, body, frameId);
}

export function resetCameraSession() {
  pendingFrame = null;
  pendingPaint = null;
  decoderBusy = false;
  inFlightDecodeStartedAt = 0;
  staleFramesBeforeTs = Date.now();
  inFlightFrameId = 0;
  inFlightGrabTs = 0;
  inFlightCapturedAt = 0;
  getWorker().postMessage({ type: 'clear-queue', epoch: frameEpoch, reason: 'session-reset' });
  flushCameraStream('session-reset');
}

function toArrayBuffer(body: ArrayBufferLike): ArrayBuffer {
  if (body instanceof ArrayBuffer) return body;
  const u8 = body as unknown as Uint8Array;
  return u8.slice().buffer as ArrayBuffer;
}

function postFrameToWorker(meta: CameraFrameMeta, body: ArrayBufferLike, frameId: number) {
  const worker = getWorker();
  const ab = toArrayBuffer(body);
  decoderBusy = true;
  inFlightCapturedAt = meta.capturedAt ?? Date.now();
  inFlightGrabTs = meta.grabTs ?? inFlightCapturedAt;
  inFlightFrameId = frameId;
  inFlightDecodeStartedAt = Date.now();
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
  staleFramesBeforeTs = ts;
  if (pendingFrame) {
    ackCameraFrame(pendingFrame.frameId);
    pendingFrame = null;
  }
  if (pendingPaint) {
    pendingPaint = null;
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

export function bumpFrameEpochOnCanvasClear(): number {
  frameEpoch += 1;
  dropPendingCameraFrames('objective-change');
  flushCameraStream('objective-change');
  return frameEpoch;
}

export function waitForFreshCameraFrame(timeoutMs = 1500): Promise<boolean> {
  const startedAt = Date.now();
  const targetEpoch = frameEpoch;
  const baselinePaint = lastPaintAt;
  return new Promise<boolean>((resolve) => {
    const tick = () => {
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
    installMainThreadPaintHandler();
    attached = { el, fallbackCtx: el.getContext('2d') };
  }, []);

  useEffect(() => {
    subscribeIpcOnce();
    if (attachOnceRef.current) return;
    attachOnceRef.current = true;
  }, []);

  return { attachCanvas };
}
