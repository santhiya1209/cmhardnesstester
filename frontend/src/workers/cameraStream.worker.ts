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
  | 'rgba32'
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
  // Main-process-assigned monotonic frame counter (meta.frameId). Echoed back
  // verbatim so the renderer paint log uses the SAME id as
  // [camera-frame-capture]/-send/-recv. Without this, the renderer was logging
  // 0 (or stale inFlightFrameId) because the variable could be overwritten by
  // a newer post before rAF fired.
  frameId?: number;
  // Live-preview subsample factor. 1 = full res (no downscale). 2 = half
  // width/height (¼ pixels, ¼ work, ¼ transfer). The visible canvas binds to
  // CSS dimensions so the user doesn't see a resolution change — only the
  // worker→main ImageData is smaller. Auto Measure reads the raw full-res
  // buffer held in the renderer hook, not the visible canvas.
  previewScale?: number;
};
type DisposeMsg = { type: 'dispose' };
type ClearQueueMsg = { type: 'clear-queue'; epoch?: number; reason?: string };
type IncomingMsg = InitMsg | Init2dMsg | FrameMsg | ClearQueueMsg | DisposeMsg;

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

// Precomputed 256-entry LUT mapping mono8 byte → packed RGBA32 (little-endian
// A=0xFF, B=G=R=v). Single typed-array load + single typed-array store per
// pixel — the V8 JIT lowers this to ~3 native instructions vs ~6-8 for the
// arithmetic version. For a 2592x1944 (~5MP) mono frame this is the dominant
// optimization: the per-pixel bitwise expression is the hot path the profiler
// flagged at 20-36ms.
const MONO_LUT: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let v = 0; v < 256; v++) t[v] = 0xff000000 | (v << 16) | (v << 8) | v;
  return t;
})();

// Unroll factor for the mono inner loop. 8 was chosen empirically: large
// enough to amortize the loop-counter overhead but small enough that V8
// keeps the unrolled body in its hot inlining budget.
function decodeMono8(u8: Uint8Array, dst32: Uint32Array, total: number): void {
  const lut = MONO_LUT;
  const end = total - (total & 7);
  let i = 0;
  for (; i < end; i += 8) {
    dst32[i]     = lut[u8[i]     as number] as number;
    dst32[i + 1] = lut[u8[i + 1] as number] as number;
    dst32[i + 2] = lut[u8[i + 2] as number] as number;
    dst32[i + 3] = lut[u8[i + 3] as number] as number;
    dst32[i + 4] = lut[u8[i + 4] as number] as number;
    dst32[i + 5] = lut[u8[i + 5] as number] as number;
    dst32[i + 6] = lut[u8[i + 6] as number] as number;
    dst32[i + 7] = lut[u8[i + 7] as number] as number;
  }
  for (; i < total; i++) dst32[i] = lut[u8[i] as number] as number;
}

// Nearest-neighbor downscale + mono→RGBA in a single pass. For scale=2 on a
// 2592x1944 frame this reads 1/4 of the source bytes and writes 1/4 of the
// dest words, dropping the conversion from ~30ms to ~7-8ms. Nearest-neighbor
// (no averaging) is visually acceptable for microscope preview at typical
// viewport sizes; if banding ever shows up, swap in box-filter (4-tap avg)
// which costs ~2x but still beats full-res convert.
function decodeMono8Downscale(
  u8: Uint8Array,
  dst32: Uint32Array,
  srcW: number,
  dstW: number,
  dstH: number,
  scale: number
): void {
  const lut = MONO_LUT;
  let dIdx = 0;
  for (let dy = 0; dy < dstH; dy++) {
    let sIdx = dy * scale * srcW;
    for (let dx = 0; dx < dstW; dx++) {
      dst32[dIdx++] = lut[u8[sIdx] as number] as number;
      sIdx += scale;
    }
  }
}

function decodeMono16Downscale(
  u16: Uint16Array,
  dst32: Uint32Array,
  srcW: number,
  dstW: number,
  dstH: number,
  scale: number
): void {
  const lut = MONO_LUT;
  let dIdx = 0;
  for (let dy = 0; dy < dstH; dy++) {
    let sIdx = dy * scale * srcW;
    for (let dx = 0; dx < dstW; dx++) {
      dst32[dIdx++] = lut[(u16[sIdx] as number) >> 8] as number;
      sIdx += scale;
    }
  }
}

// rgb24 / bgr24 nearest-neighbor downscale. Source is 3 bytes/pixel; dst is
// 32-bit RGBA. For scale=2 on 2592x1944 this reads 25% of source bytes
// (~3.75MB instead of 15MB) and writes a 1296x972 RGBA preview.
function decodeRgb24Downscale(
  u8: Uint8Array,
  dst32: Uint32Array,
  srcW: number,
  dstW: number,
  dstH: number,
  scale: number,
  swap: boolean
): void {
  const rowStride = srcW * 3;
  const pixelStride = 3 * scale;
  let dIdx = 0;
  if (swap) {
    // bgr24: source[s..s+2] = B,G,R
    for (let dy = 0; dy < dstH; dy++) {
      let s = dy * scale * rowStride;
      for (let dx = 0; dx < dstW; dx++) {
        const b = u8[s] as number;
        const g = u8[s + 1] as number;
        const r = u8[s + 2] as number;
        dst32[dIdx++] = 0xff000000 | (b << 16) | (g << 8) | r;
        s += pixelStride;
      }
    }
  } else {
    // rgb24: source[s..s+2] = R,G,B
    for (let dy = 0; dy < dstH; dy++) {
      let s = dy * scale * rowStride;
      for (let dx = 0; dx < dstW; dx++) {
        const r = u8[s] as number;
        const g = u8[s + 1] as number;
        const b = u8[s + 2] as number;
        dst32[dIdx++] = 0xff000000 | (b << 16) | (g << 8) | r;
        s += pixelStride;
      }
    }
  }
}

// rgb32 / bgr32 nearest-neighbor downscale. Source is already 32 bits/pixel;
// we just sample every `scale`th word and (for bgr32) swap R↔B.
function decodeRgb32Downscale(
  src32: Uint32Array,
  dst32: Uint32Array,
  srcW: number,
  dstW: number,
  dstH: number,
  scale: number,
  swap: boolean
): void {
  let dIdx = 0;
  if (swap) {
    for (let dy = 0; dy < dstH; dy++) {
      let s = dy * scale * srcW;
      for (let dx = 0; dx < dstW; dx++) {
        const p = src32[s] as number;
        dst32[dIdx++] =
          (p & 0xff00ff00) | ((p & 0x00ff0000) >>> 16) | ((p & 0x000000ff) << 16);
        s += scale;
      }
    }
  } else {
    for (let dy = 0; dy < dstH; dy++) {
      let s = dy * scale * srcW;
      for (let dx = 0; dx < dstW; dx++) {
        dst32[dIdx++] = src32[s] as number;
        s += scale;
      }
    }
  }
}

function decodeMono16(u16: Uint16Array, dst32: Uint32Array, total: number): void {
  const lut = MONO_LUT;
  const end = total - (total & 7);
  let i = 0;
  for (; i < end; i += 8) {
    dst32[i]     = lut[(u16[i]     as number) >> 8] as number;
    dst32[i + 1] = lut[(u16[i + 1] as number) >> 8] as number;
    dst32[i + 2] = lut[(u16[i + 2] as number) >> 8] as number;
    dst32[i + 3] = lut[(u16[i + 3] as number) >> 8] as number;
    dst32[i + 4] = lut[(u16[i + 4] as number) >> 8] as number;
    dst32[i + 5] = lut[(u16[i + 5] as number) >> 8] as number;
    dst32[i + 6] = lut[(u16[i + 6] as number) >> 8] as number;
    dst32[i + 7] = lut[(u16[i + 7] as number) >> 8] as number;
  }
  for (; i < total; i++) dst32[i] = lut[(u16[i] as number) >> 8] as number;
}

function decode(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  pixelFormat: PixelFormat,
  bits: 8 | 16,
  previewScale: number
): ImageData {
  // All known DVP output formats now have a downscale path. The camera in
  // this product actually outputs rgb24 (15MB per 5MP frame) — that's the
  // dominant case we need to cover.
  const canDownscale =
    pixelFormat === 'mono8' ||
    pixelFormat === 'rgb24' ||
    pixelFormat === 'bgr24' ||
    pixelFormat === 'rgb32' ||
    pixelFormat === 'rgba32' ||
    pixelFormat === 'bgr32' ||
    pixelFormat === 'bayer_bg' ||
    pixelFormat === 'bayer_gb' ||
    pixelFormat === 'bayer_gr' ||
    pixelFormat === 'bayer_rg' ||
    pixelFormat === 'raw';
  const scale =
    canDownscale && previewScale >= 2 && Number.isInteger(previewScale)
      ? previewScale
      : 1;
  const dstW = scale === 1 ? width : Math.floor(width / scale);
  const dstH = scale === 1 ? height : Math.floor(height / scale);
  const out = ensureImageData(dstW, dstH);
  const dst = out.data;
  const dst32 = new Uint32Array(dst.buffer, dst.byteOffset, dstW * dstH);
  const total = width * height;

  if (pixelFormat === 'mono8') {
    if (bits === 16) {
      if (scale === 1) decodeMono16(new Uint16Array(buffer), dst32, total);
      else decodeMono16Downscale(new Uint16Array(buffer), dst32, width, dstW, dstH, scale);
    } else {
      if (scale === 1) decodeMono8(new Uint8Array(buffer), dst32, total);
      else decodeMono8Downscale(new Uint8Array(buffer), dst32, width, dstW, dstH, scale);
    }
    return out;
  }

  if (pixelFormat === 'rgb24' || pixelFormat === 'bgr24') {
    const swap = pixelFormat === 'bgr24';
    if (scale > 1) {
      decodeRgb24Downscale(new Uint8Array(buffer), dst32, width, dstW, dstH, scale, swap);
      return out;
    }
    const u8 = new Uint8Array(buffer);
    let s = 0;
    const end = total - (total & 3);
    let i = 0;
    if (swap) {
      for (; i < end; i += 4) {
        const b0 = u8[s] as number, g0 = u8[s + 1] as number, r0 = u8[s + 2] as number;
        const b1 = u8[s + 3] as number, g1 = u8[s + 4] as number, r1 = u8[s + 5] as number;
        const b2 = u8[s + 6] as number, g2 = u8[s + 7] as number, r2 = u8[s + 8] as number;
        const b3 = u8[s + 9] as number, g3 = u8[s + 10] as number, r3 = u8[s + 11] as number;
        s += 12;
        dst32[i]     = 0xff000000 | (b0 << 16) | (g0 << 8) | r0;
        dst32[i + 1] = 0xff000000 | (b1 << 16) | (g1 << 8) | r1;
        dst32[i + 2] = 0xff000000 | (b2 << 16) | (g2 << 8) | r2;
        dst32[i + 3] = 0xff000000 | (b3 << 16) | (g3 << 8) | r3;
      }
      for (; i < total; i++) {
        const b = u8[s++] as number;
        const g = u8[s++] as number;
        const r = u8[s++] as number;
        dst32[i] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
    } else {
      for (; i < end; i += 4) {
        const r0 = u8[s] as number, g0 = u8[s + 1] as number, b0 = u8[s + 2] as number;
        const r1 = u8[s + 3] as number, g1 = u8[s + 4] as number, b1 = u8[s + 5] as number;
        const r2 = u8[s + 6] as number, g2 = u8[s + 7] as number, b2 = u8[s + 8] as number;
        const r3 = u8[s + 9] as number, g3 = u8[s + 10] as number, b3 = u8[s + 11] as number;
        s += 12;
        dst32[i]     = 0xff000000 | (b0 << 16) | (g0 << 8) | r0;
        dst32[i + 1] = 0xff000000 | (b1 << 16) | (g1 << 8) | r1;
        dst32[i + 2] = 0xff000000 | (b2 << 16) | (g2 << 8) | r2;
        dst32[i + 3] = 0xff000000 | (b3 << 16) | (g3 << 8) | r3;
      }
      for (; i < total; i++) {
        const r = u8[s++] as number;
        const g = u8[s++] as number;
        const b = u8[s++] as number;
        dst32[i] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
    }
    return out;
  }

  if (pixelFormat === 'rgb32' || pixelFormat === 'rgba32' || pixelFormat === 'bgr32') {
    const swap32 = pixelFormat === 'bgr32';
    if (scale > 1) {
      decodeRgb32Downscale(new Uint32Array(buffer), dst32, width, dstW, dstH, scale, swap32);
      return out;
    }
    // The source is already 32-bit-per-pixel; we only need a byte-swap when
    // the channel order differs. Use a Uint32Array view directly — one load
    // + one store per pixel, no per-byte arithmetic.
    const src32 = new Uint32Array(buffer);
    if (pixelFormat === 'rgb32' || pixelFormat === 'rgba32') {
      // src is RGBA (R lowest byte little-endian) which is exactly what
      // canvas expects. Direct copy via .set() — one C-level memcpy.
      dst32.set(src32.subarray(0, total));
    } else {
      // BGRA → RGBA: swap byte 0 and byte 2 of each 32-bit word, keep alpha.
      const end = total - (total & 3);
      let i = 0;
      for (; i < end; i += 4) {
        const p0 = src32[i] as number;
        const p1 = src32[i + 1] as number;
        const p2 = src32[i + 2] as number;
        const p3 = src32[i + 3] as number;
        dst32[i]     = (p0 & 0xff00ff00) | ((p0 & 0x00ff0000) >>> 16) | ((p0 & 0x000000ff) << 16);
        dst32[i + 1] = (p1 & 0xff00ff00) | ((p1 & 0x00ff0000) >>> 16) | ((p1 & 0x000000ff) << 16);
        dst32[i + 2] = (p2 & 0xff00ff00) | ((p2 & 0x00ff0000) >>> 16) | ((p2 & 0x000000ff) << 16);
        dst32[i + 3] = (p3 & 0xff00ff00) | ((p3 & 0x00ff0000) >>> 16) | ((p3 & 0x000000ff) << 16);
      }
      for (; i < total; i++) {
        const p = src32[i] as number;
        dst32[i] = (p & 0xff00ff00) | ((p & 0x00ff0000) >>> 16) | ((p & 0x000000ff) << 16);
      }
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
    // grayscale (each sensor pixel → one greyscale pixel, no demosaic).
    if (bits === 16) {
      if (scale === 1) decodeMono16(new Uint16Array(buffer), dst32, total);
      else decodeMono16Downscale(new Uint16Array(buffer), dst32, width, dstW, dstH, scale);
    } else {
      if (scale === 1) decodeMono8(new Uint8Array(buffer), dst32, total);
      else decodeMono8Downscale(new Uint8Array(buffer), dst32, width, dstW, dstH, scale);
    }
    return out;
  }

  // 'raw' — best-effort grayscale assume 8-bit
  if (scale === 1) decodeMono8(new Uint8Array(buffer), dst32, total);
  else decodeMono8Downscale(new Uint8Array(buffer), dst32, width, dstW, dstH, scale);
  return out;
}

let paintCount = 0;
let lastConvertLogAt = 0;
let lastPreviewLogAt = 0;
function paint(frame: FrameMsg) {
  const previewScale = frame.previewScale ?? 1;
  const t0 = performance.now();
  const img = decode(
    frame.buffer,
    frame.width,
    frame.height,
    frame.pixelFormat,
    frame.bits,
    previewScale
  );
  const convertMs = performance.now() - t0;
  // Strict positive check. `frame.frameId ?? 0` would still accept the literal
  // 0 (which means "main forgot to populate the field") — and we'd then log
  // frameId=0 forever. Treat 0/undefined/non-number as missing.
  const rawFid = (frame as { frameId?: unknown }).frameId;
  const frameId =
    typeof rawFid === 'number' && rawFid > 0 ? rawFid : 0;
  // Always log slow conversions so post-optimization regressions surface;
  // throttle fast ones to 1Hz to keep DevTools readable.
  const nowMs = Date.now();
  const slow = convertMs > 10;
  if (slow || nowMs - lastConvertLogAt > 5000) {
    lastConvertLogAt = nowMs;
    // eslint-disable-next-line no-console
    console.log(
      `[camera-frame-convert] frameId=${frameId} ms=${convertMs.toFixed(2)} scale=${previewScale}${slow ? ' SLOW' : ''}`
    );
    // Same data under the canonical name the diagnostic spec asks for.
    // eslint-disable-next-line no-console
    console.log(
      `[camera-convert-ms] frameId=${frameId} ms=${convertMs.toFixed(2)} scale=${previewScale} bytes=${frame.buffer.byteLength}`
    );
    // Color-conversion specifically: rgb24/bgr24/mono8/bayer_* → RGBA32 for
    // the canvas. Worker-side cost; native does no conversion. Same value
    // as convertMs — emitted under the requested name for traceability.
    // eslint-disable-next-line no-console
    console.log(
      `[camera-color-convert-ms] frameId=${frameId} ms=${convertMs.toFixed(2)} from=${frame.pixelFormat} to=rgba32 scale=${previewScale}`
    );
  }
  if (nowMs - lastPreviewLogAt > 5000) {
    lastPreviewLogAt = nowMs;
    const sourceBytes = frame.buffer.byteLength;
    const previewBytes = img.data.byteLength;
    // eslint-disable-next-line no-console
    console.log(
      `[camera-live-preview] sourceBytes=${sourceBytes} previewWidth=${img.width} previewHeight=${img.height} previewBytes=${previewBytes} scale=${previewScale}`
    );
  }
  if (mainThreadPaint) {
    // ImageData was freshly allocated by ensureImageData() above, so we can
    // transfer its backing store directly — zero copies. Previously this
    // path did `new Uint8ClampedArray(img.data)` which was an ~8MB memcpy
    // per 1080p frame.
    (self as DedicatedWorkerGlobalScope).postMessage(
      {
        type: 'paint',
        imageData: img,
        epoch: frame.epoch ?? 0,
        seq: frame.seq ?? 0,
        frameId,
      },
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
  if (canvas.width !== img.width || canvas.height !== img.height) {
    canvas.width = img.width;
    canvas.height = img.height;
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
  } else if (msg.type === 'clear-queue') {
    imageData = null;
    imageDataDims = null;
    // eslint-disable-next-line no-console
    console.log(
      `[camera-worker-queue-clear] reason=${msg.reason ?? 'unknown'} epoch=${msg.epoch ?? 0}`
    );
  } else if (msg.type === 'dispose') {
    canvas = null;
    ctx = null;
    imageData = null;
    imageDataDims = null;
    (self as DedicatedWorkerGlobalScope).close();
  }
};
