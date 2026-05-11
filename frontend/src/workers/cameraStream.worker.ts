/// <reference lib="webworker" />
/*
 * cameraStream.worker.ts
 *
 * Receives transferred OffscreenCanvas + per-frame ArrayBuffers, decodes the
 * raw camera bytes (mono8 / rgb24 / bgr24 / *32) into ImageData, and draws
 * via OffscreenCanvasRenderingContext2D.putImageData. Throttles to one paint
 * per ArrayBuffer (no rAF needed inside a worker — incoming frame rate is
 * already the limiter).
 *
 * Messages in:
 *   { type: 'init',    canvas: OffscreenCanvas }
 *   { type: 'init-2d' }                          // OffscreenCanvas not supported
 *   { type: 'frame',   buffer, width, height, pixelFormat, bits }
 *   { type: 'dispose' }
 *
 * Messages out (only when init-2d is in use):
 *   { type: 'paint', imageData: ImageData }
 */

type PixelFormat =
  | 'mono8'
  | 'rgb24'
  | 'bgr24'
  | 'rgb32'
  | 'bgr32'
  | 'bayer_bg'
  | 'bayer_gb'
  | 'bayer_gr'
  | 'bayer_rg'
  | 'raw';

type InitMsg = { type: 'init'; canvas: OffscreenCanvas };
type Init2dMsg = { type: 'init-2d' };
type FrameMsg = {
  type: 'frame';
  buffer: ArrayBuffer;
  width: number;
  height: number;
  pixelFormat: PixelFormat;
  bits: 8 | 16;
  // Tagged by the main thread with the live frameEpoch when posted. Echoed
  // back in the 'paint' message so the main-thread paint handler can drop
  // paints whose frame was received before the latest canvas clear.
  epoch?: number;
  seq?: number;
};
type DisposeMsg = { type: 'dispose' };
type IncomingMsg = InitMsg | Init2dMsg | FrameMsg | DisposeMsg;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let mainThreadPaint = false;
let imageData: ImageData | null = null;
let imageDataDims: { w: number; h: number } | null = null;

function ensureImageData(w: number, h: number): ImageData {
  // In the main-thread paint path (2D-fallback) we need to transfer the
  // decoded ImageData to the renderer — and transferring detaches the
  // backing store. Reusing a single shared ImageData would therefore force
  // us to memcpy the pixels into a fresh buffer every frame (the previous
  // code's `new Uint8ClampedArray(img.data)` line). For a 1920x1080 frame
  // that is ~8 MB / frame of avoidable copying. Allocate fresh per frame
  // when we know we're about to transfer.
  if (mainThreadPaint) {
    return new ImageData(w, h);
  }
  if (imageData && imageDataDims && imageDataDims.w === w && imageDataDims.h === h) {
    return imageData;
  }
  imageData = new ImageData(w, h);
  imageDataDims = { w, h };
  return imageData;
}

function decode(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  pixelFormat: PixelFormat,
  bits: 8 | 16
): ImageData {
  const out = ensureImageData(width, height);
  const dst = out.data;
  const src = bits === 16 ? new Uint16Array(buffer) : new Uint8Array(buffer);
  const total = width * height;
  const shift = bits === 16 ? 8 : 0;

  if (pixelFormat === 'mono8') {
    for (let i = 0; i < total; i++) {
      const v = bits === 16 ? (src[i] as number) >> shift : (src[i] as number);
      const j = i << 2;
      dst[j] = v;
      dst[j + 1] = v;
      dst[j + 2] = v;
      dst[j + 3] = 255;
    }
    return out;
  }

  if (pixelFormat === 'rgb24' || pixelFormat === 'bgr24') {
    const swap = pixelFormat === 'bgr24';
    const u8 = bits === 16 ? new Uint8Array(buffer) : (src as Uint8Array);
    let s = 0;
    let d = 0;
    for (let i = 0; i < total; i++) {
      const c0 = u8[s++] as number;
      const c1 = u8[s++] as number;
      const c2 = u8[s++] as number;
      dst[d++] = swap ? c2 : c0;
      dst[d++] = c1;
      dst[d++] = swap ? c0 : c2;
      dst[d++] = 255;
    }
    return out;
  }

  if (pixelFormat === 'rgb32' || pixelFormat === 'bgr32') {
    const swap = pixelFormat === 'bgr32';
    const u8 = bits === 16 ? new Uint8Array(buffer) : (src as Uint8Array);
    let s = 0;
    let d = 0;
    for (let i = 0; i < total; i++) {
      const c0 = u8[s++] as number;
      const c1 = u8[s++] as number;
      const c2 = u8[s++] as number;
      s++; // skip 4th byte
      dst[d++] = swap ? c2 : c0;
      dst[d++] = c1;
      dst[d++] = swap ? c0 : c2;
      dst[d++] = 255;
    }
    return out;
  }

  if (
    pixelFormat === 'bayer_bg' ||
    pixelFormat === 'bayer_gb' ||
    pixelFormat === 'bayer_gr' ||
    pixelFormat === 'bayer_rg'
  ) {
    // Microscopy preview only needs luminance — render the Bayer mosaic as
    // grayscale (each sensor pixel → one greyscale pixel, no demosaic). Cheap,
    // correct enough for indent visualization. If color preview is ever
    // needed, swap in a 2x2 demosaic here.
    const u8 = bits === 16 ? new Uint8Array(buffer) : (src as Uint8Array);
    if (bits === 16) {
      const u16 = src as Uint16Array;
      for (let i = 0; i < total; i++) {
        const v = (u16[i] as number) >> shift;
        const j = i << 2;
        dst[j] = v;
        dst[j + 1] = v;
        dst[j + 2] = v;
        dst[j + 3] = 255;
      }
    } else {
      for (let i = 0; i < total; i++) {
        const v = u8[i] as number;
        const j = i << 2;
        dst[j] = v;
        dst[j + 1] = v;
        dst[j + 2] = v;
        dst[j + 3] = 255;
      }
    }
    return out;
  }

  // 'raw' — best-effort grayscale assume 8-bit
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < total; i++) {
    const v = u8[i] as number;
    const j = i << 2;
    dst[j] = v;
    dst[j + 1] = v;
    dst[j + 2] = v;
    dst[j + 3] = 255;
  }
  return out;
}

let paintCount = 0;
let lastConvertLogAt = 0;
function paint(frame: FrameMsg) {
  const t0 = performance.now();
  const img = decode(frame.buffer, frame.width, frame.height, frame.pixelFormat, frame.bits);
  const convertMs = performance.now() - t0;
  // Throttled per-stage timing — every ~1s. Per-frame logging at 30fps
  // would flood DevTools and itself add measurable latency.
  const nowMs = Date.now();
  if (nowMs - lastConvertLogAt > 1000) {
    lastConvertLogAt = nowMs;
    // eslint-disable-next-line no-console
    console.log(
      `[camera-frame-convert] frameId=${frame.seq ?? 0} ms=${convertMs.toFixed(2)}`
    );
  }
  if (mainThreadPaint) {
    // ImageData was freshly allocated by ensureImageData() above, so we can
    // transfer its backing store directly — zero copies. Previously this
    // path did `new Uint8ClampedArray(img.data)` which was an ~8MB memcpy
    // per 1080p frame.
    (self as DedicatedWorkerGlobalScope).postMessage(
      { type: 'paint', imageData: img, epoch: frame.epoch ?? 0, seq: frame.seq ?? 0 },
      [img.data.buffer]
    );
    return;
  }
  if (!canvas || !ctx) {
    if (paintCount === 0) {
      // eslint-disable-next-line no-console
      console.warn('[worker] paint called but canvas/ctx is null', {
        hasCanvas: !!canvas,
        hasCtx: !!ctx,
        mainThreadPaint,
      });
    }
    return;
  }
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  ctx.putImageData(img, 0, 0);
  if (paintCount === 0) {
    // eslint-disable-next-line no-console
    console.log('[worker] first paint OK', {
      bitmapW: canvas.width,
      bitmapH: canvas.height,
      pixelFormat: frame.pixelFormat,
    });
  }
  paintCount++;
}

self.onmessage = (e: MessageEvent<IncomingMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    canvas = msg.canvas;
    ctx = canvas.getContext('2d');
    mainThreadPaint = false;
    // eslint-disable-next-line no-console
    console.log('[worker] init OK', { hasCanvas: !!canvas, hasCtx: !!ctx });
  } else if (msg.type === 'init-2d') {
    canvas = null;
    ctx = null;
    mainThreadPaint = true;
  } else if (msg.type === 'frame') {
    paint(msg);
  } else if (msg.type === 'dispose') {
    canvas = null;
    ctx = null;
    imageData = null;
    imageDataDims = null;
    (self as DedicatedWorkerGlobalScope).close();
  }
};
