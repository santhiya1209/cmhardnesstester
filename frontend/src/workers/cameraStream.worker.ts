/// <reference lib="webworker" />

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

type FrameMsg = {
  type: 'frame';
  buffer: ArrayBuffer;
  width: number;
  height: number;
  pixelFormat: PixelFormat;
  bits: 8 | 16;
  epoch?: number;
  seq?: number;
  frameId?: number;
  previewScale?: number;
};
type DisposeMsg = { type: 'dispose' };
type ClearQueueMsg = { type: 'clear-queue'; epoch?: number; reason?: string };
type IncomingMsg = FrameMsg | ClearQueueMsg | DisposeMsg;

function ensureImageData(w: number, h: number): ImageData {
  return new ImageData(w, h);
}

const MONO_LUT: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let v = 0; v < 256; v++) t[v] = 0xff000000 | (v << 16) | (v << 8) | v;
  return t;
})();

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
    const src32 = new Uint32Array(buffer);
    if (pixelFormat === 'rgb32' || pixelFormat === 'rgba32') {
      dst32.set(src32.subarray(0, total));
    } else {
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
    if (bits === 16) {
      if (scale === 1) decodeMono16(new Uint16Array(buffer), dst32, total);
      else decodeMono16Downscale(new Uint16Array(buffer), dst32, width, dstW, dstH, scale);
    } else {
      if (scale === 1) decodeMono8(new Uint8Array(buffer), dst32, total);
      else decodeMono8Downscale(new Uint8Array(buffer), dst32, width, dstW, dstH, scale);
    }
    return out;
  }

  if (scale === 1) decodeMono8(new Uint8Array(buffer), dst32, total);
  else decodeMono8Downscale(new Uint8Array(buffer), dst32, width, dstW, dstH, scale);
  return out;
}

let resolutionLogged = false;
function paint(frame: FrameMsg) {
  const previewScale = frame.previewScale ?? 1;
  const decodeT0 = performance.now();
  const img = decode(
    frame.buffer,
    frame.width,
    frame.height,
    frame.pixelFormat,
    frame.bits,
    previewScale
  );
  const decodeMs = performance.now() - decodeT0;
  if (!resolutionLogged) {
    resolutionLogged = true;
    // eslint-disable-next-line no-console
    console.log(
      `[camera-worker][decoded-resolution] ${img.width}x${img.height} ` +
        `(from ${frame.width}x${frame.height} previewScale=${previewScale} ` +
        `pixelFormat=${frame.pixelFormat} bits=${frame.bits} ` +
        `paintPath=2d-canvas)`
    );
  }
  const rawFid = (frame as { frameId?: unknown }).frameId;
  const frameId =
    typeof rawFid === 'number' && rawFid > 0 ? rawFid : 0;
  (self as DedicatedWorkerGlobalScope).postMessage(
    {
      type: 'paint',
      imageData: img,
      epoch: frame.epoch ?? 0,
      seq: frame.seq ?? 0,
      frameId,
      decodeMs,
    },
    [img.data.buffer]
  );
}

self.onmessage = (e: MessageEvent<IncomingMsg>) => {
  const msg = e.data;
  if (msg.type === 'frame') {
    paint(msg);
  } else if (msg.type === 'clear-queue') {
  } else if (msg.type === 'dispose') {
    (self as DedicatedWorkerGlobalScope).close();
  }
};
