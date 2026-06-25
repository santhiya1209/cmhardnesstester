import { useCallback, useEffect, useRef } from 'react';
import CameraStreamWorker from '@/workers/cameraStream.worker.ts?worker';
import { ackCameraFrame } from '@/api/camera';
import { flushCameraStream } from '@/api/camera';
import { mlog } from '@/utils/measureDebug';
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
  decodeMs: number;
  ipcMs: number;
  mainAgeMs: number;
  sdkMs: number;
  exposureMs: number;
  gain: number;
  paintMsgAt: number;
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

let perfStaleDrops = 0;
let perfSupersededDrops = 0;
let perfInFlightIpcMs = -1;
let perfInFlightMainAgeMs = -1;
let perfInFlightSdkMs = -1;
let perfInFlightExposureMs = -1;
let perfInFlightGain = -1;
let perfWindowStartAt = 0;
let perfPaintCount = 0;
let perfSumSdk = 0, perfCntSdk = 0;
let perfSumIpc = 0, perfCntIpc = 0;
let perfSumDecode = 0, perfCntDecode = 0;
let perfSumPaint = 0, perfCntPaint = 0;
let perfMaxFrameAge = 0;
let perfLastSampleLineAt = 0;
let perfLastFpsPaintAt = 0;

function perfNum(v: number): string {
  return v >= 0 ? String(Math.round(v * 100) / 100) : 'n/a';
}

function perfAccumulate(sample: {
  sdkMs: number;
  mainAgeMs: number;
  ipcMs: number;
  decodeMs: number;
  paintDelayMs: number;
  frameAgeMs: number;
  exposureMs: number;
  gain: number;
}) {
  const now = Date.now();
  if (perfWindowStartAt === 0) perfWindowStartAt = now;
  perfPaintCount += 1;
  if (sample.sdkMs >= 0) { perfSumSdk += sample.sdkMs; perfCntSdk += 1; }
  if (sample.ipcMs >= 0) { perfSumIpc += sample.ipcMs; perfCntIpc += 1; }
  if (sample.decodeMs >= 0) { perfSumDecode += sample.decodeMs; perfCntDecode += 1; }
  if (sample.paintDelayMs >= 0) { perfSumPaint += sample.paintDelayMs; perfCntPaint += 1; }
  if (sample.frameAgeMs > perfMaxFrameAge) perfMaxFrameAge = sample.frameAgeMs;

  const fps =
    perfLastFpsPaintAt > 0 && now > perfLastFpsPaintAt ? 1000 / (now - perfLastFpsPaintAt) : 0;
  perfLastFpsPaintAt = now;

  if (now - perfLastSampleLineAt >= 1000) {
    perfLastSampleLineAt = now;
    /* eslint-disable no-console */
    console.log(`[camera-perf] sdkGetFrameMs=${perfNum(sample.sdkMs)}`);
    console.log(`[camera-perf] mainFrameAgeMs=${perfNum(sample.mainAgeMs)}`);
    console.log(`[camera-perf] ipcTransferMs=${perfNum(sample.ipcMs)}`);
    console.log(`[camera-perf] workerDecodeMs=${perfNum(sample.decodeMs)}`);
    console.log(`[camera-perf] paintDelayMs=${perfNum(sample.paintDelayMs)}`);
    console.log(`[camera-perf] staleDrops=${perfStaleDrops} supersededDrops=${perfSupersededDrops}`);
    console.log(
      `[camera-perf] fps=${fps.toFixed(1)} exposureMs=${perfNum(sample.exposureMs)} gain=${perfNum(sample.gain)}`
    );
    /* eslint-enable no-console */
  }

  const windowMs = now - perfWindowStartAt;
  if (windowMs >= 5000) {
    const avg = (sum: number, cnt: number) => (cnt > 0 ? (sum / cnt).toFixed(2) : 'n/a');
    const summaryFps = (perfPaintCount / (windowMs / 1000)).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(
      `[camera-perf-summary] sdkAvg=${avg(perfSumSdk, perfCntSdk)} ipcAvg=${avg(perfSumIpc, perfCntIpc)} decodeAvg=${avg(perfSumDecode, perfCntDecode)} paintAvg=${avg(perfSumPaint, perfCntPaint)} fps=${summaryFps} staleDrops=${perfStaleDrops} supersededDrops=${perfSupersededDrops} maxFrameAge=${Math.round(perfMaxFrameAge)}`
    );
    perfWindowStartAt = now;
    perfPaintCount = 0;
    perfSumSdk = perfCntSdk = 0;
    perfSumIpc = perfCntIpc = 0;
    perfSumDecode = perfCntDecode = 0;
    perfSumPaint = perfCntPaint = 0;
    perfMaxFrameAge = 0;
  }
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
    (
      e: MessageEvent<{
        type: string;
        imageData?: ImageData;
        epoch?: number;
        frameId?: number;
        decodeMs?: number;
      }>
    ) => {
      if (!e.data || e.data.type !== 'paint' || !e.data.imageData) return;
      const paintEpoch = typeof e.data.epoch === 'number' ? e.data.epoch : 0;
      const echoedRaw = (e.data as { frameId?: unknown }).frameId;
      const echoedFrameId =
        typeof echoedRaw === 'number' && echoedRaw > 0 ? echoedRaw : 0;
      const resolvedFrameId =
        echoedFrameId > 0 ? echoedFrameId : inFlightFrameId;
      if (paintEpoch < frameEpoch) {
        perfSupersededDrops += 1;
        decoderBusy = false;
        if (resolvedFrameId > 0) ackCameraFrame(resolvedFrameId);
        flushPendingFrame();
        return;
      }
      const ageAtStash = inFlightGrabTs > 0 ? Date.now() - inFlightGrabTs : 0;
      if (ageAtStash > STALE_AGE_MS) {
        perfStaleDrops += 1;
        decoderBusy = false;
        if (resolvedFrameId > 0) ackCameraFrame(resolvedFrameId);
        flushPendingFrame();
        return;
      }
      const decodeMs = typeof e.data.decodeMs === 'number' ? e.data.decodeMs : -1;
      pendingPaint = {
        imageData: e.data.imageData,
        epoch: paintEpoch,
        frameId: resolvedFrameId,
        grabTs: inFlightGrabTs,
        decodeMs,
        ipcMs: perfInFlightIpcMs,
        mainAgeMs: perfInFlightMainAgeMs,
        sdkMs: perfInFlightSdkMs,
        exposureMs: perfInFlightExposureMs,
        gain: perfInFlightGain,
        paintMsgAt: Date.now(),
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
      perfStaleDrops += 1;
      mlog('camera-render-health', { event: 'paint-skipped', reason: 'stale-before-reset', frameId: p.frameId });
      return;
    }
    if (p.grabTs > 0) {
      const ageAtPaint = Date.now() - p.grabTs;
      if (ageAtPaint > STALE_AGE_MS) {
        perfStaleDrops += 1;
        mlog('camera-render-health', { event: 'paint-skipped', reason: 'age', frameId: p.frameId, ageMs: ageAtPaint });
        return;
      }
    }
    if (!attached || !attached.fallbackCtx) {
      mlog('camera-render-health', { event: 'paint-skipped', reason: 'no-canvas', frameId: p.frameId });
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
    mlog('camera-render-health', {
      event: 'paint-finished',
      frameId: p.frameId,
      ageMs: p.grabTs > 0 ? Math.max(0, lastPaintAt - p.grabTs) : -1,
      dropped1s: perfStaleDrops + perfSupersededDrops,
    });
    perfAccumulate({
      sdkMs: p.sdkMs,
      mainAgeMs: p.mainAgeMs,
      ipcMs: p.ipcMs,
      decodeMs: p.decodeMs,
      paintDelayMs: p.paintMsgAt > 0 ? Math.max(0, lastPaintAt - p.paintMsgAt) : -1,
      frameAgeMs: p.grabTs > 0 ? Math.max(0, lastPaintAt - p.grabTs) : 0,
      exposureMs: p.exposureMs,
      gain: p.gain,
    });
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
    mlog('camera-frame-age', {
      frameId,
      ageMs: grabTs > 0 ? receivedAt - grabTs : -1,
      timestamp: receivedAt,
      dropped: perfSupersededDrops,
      skipped: perfStaleDrops,
    });
    if (staleFramesBeforeTs > 0 && frameTs > 0 && frameTs < staleFramesBeforeTs) {
      perfStaleDrops += 1;
      mlog('camera-stale-frame-drop', {
        frameId,
        ageMs: grabTs > 0 ? receivedAt - grabTs : -1,
        reason: 'before-session-reset',
        staleBeforeTs: staleFramesBeforeTs,
      });
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
        perfStaleDrops += 1;
        mlog('camera-stale-frame-drop', {
          frameId,
          ageMs,
          reason: 'age-exceeds-threshold',
          thresholdMs: STALE_AGE_MS,
        });
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
        perfSupersededDrops += 1;
        ackCameraFrame(pendingFrame.frameId);
      }
      pendingFrame = { meta, body, frameId, receivedAt };
      return;
    }
    postFrameToWorker(meta, body, frameId, receivedAt);
  });
}

function flushPendingFrame() {
  if (!pendingFrame || decoderBusy) return;
  const { meta, body, frameId, receivedAt } = pendingFrame;
  pendingFrame = null;
  const grabTs = meta.grabTs ?? meta.capturedAt ?? 0;
  if (grabTs > 0 && Date.now() - grabTs > STALE_AGE_MS) {
    perfStaleDrops += 1;
    if (frameId > 0) ackCameraFrame(frameId);
    return;
  }
  postFrameToWorker(meta, body, frameId, receivedAt);
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

function postFrameToWorker(
  meta: CameraFrameMeta,
  body: ArrayBufferLike,
  frameId: number,
  receivedAt: number
) {
  const worker = getWorker();
  const ab = toArrayBuffer(body);
  decoderBusy = true;
  inFlightCapturedAt = meta.capturedAt ?? Date.now();
  inFlightGrabTs = meta.grabTs ?? inFlightCapturedAt;
  inFlightFrameId = frameId;
  inFlightDecodeStartedAt = Date.now();
  perfInFlightIpcMs =
    typeof meta.sentAt === 'number' && meta.sentAt > 0 && receivedAt > 0
      ? Math.max(0, receivedAt - meta.sentAt)
      : -1;
  perfInFlightMainAgeMs =
    typeof meta.capturedAt === 'number' &&
    typeof meta.grabTs === 'number' &&
    meta.capturedAt > 0 &&
    meta.grabTs > 0
      ? Math.max(0, meta.capturedAt - meta.grabTs)
      : -1;
  perfInFlightSdkMs =
    typeof meta.sdkGetFrameMs === 'number' && meta.sdkGetFrameMs >= 0 ? meta.sdkGetFrameMs : -1;
  perfInFlightExposureMs =
    typeof meta.exposureMs === 'number' && meta.exposureMs >= 0 ? meta.exposureMs : -1;
  perfInFlightGain = typeof meta.gain === 'number' && meta.gain >= 0 ? meta.gain : -1;
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
