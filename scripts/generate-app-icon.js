/*
 * generate-app-icon.js
 *
 * Generates the Vickers Measurement Software application icon as a
 * multi-resolution Windows .ico (plus a 256px .png) using only Node built-ins
 * (zlib for PNG compression) — no native image libraries, fully cross-platform
 * per the project shell rules.
 *
 * Design: dark navy rounded square, a sky-blue Vickers indentation diamond with
 * its two measurement diagonals, and a white center crosshair dot. This is a
 * professional placeholder; drop in a final company .ico at build/icon.ico to
 * override (electron/main.js + forge.config.js already point there).
 *
 * Outputs:
 *   build/icon.ico            — Windows/Electron app + installer + shortcut icon
 *   build/icon.png            — 256px fallback (resolveAppIcon png candidate)
 *   frontend/public/app-icon.png — renderer favicon (replaces vite.svg)
 *
 * Run: node scripts/generate-app-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

/* --------------------------------- PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------- ICO ---------------------------------- */

function buildICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  images.forEach((img, i) => {
    const base = i * 16;
    entries[base + 0] = img.size >= 256 ? 0 : img.size; // 0 means 256
    entries[base + 1] = img.size >= 256 ? 0 : img.size;
    entries[base + 2] = 0; // palette count
    entries[base + 3] = 0; // reserved
    entries.writeUInt16LE(1, base + 4); // color planes
    entries.writeUInt16LE(32, base + 6); // bits per pixel
    entries.writeUInt32LE(img.png.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += img.png.length;
    blobs.push(img.png);
  });
  return Buffer.concat([header, entries, ...blobs]);
}

/* ------------------------------- drawing -------------------------------- */

const SS = 4; // supersample factor → anti-aliasing on downscale
const L = 256; // logical canvas size
const S = L * SS; // supersampled canvas size

function makeMaster() {
  const buf = Buffer.alloc(S * S * 4, 0); // transparent

  const NAVY_TOP = [10, 42, 79];
  const NAVY_BOTTOM = [21, 69, 127];
  const DIAMOND = [79, 195, 247]; // sky blue #4FC3F7
  const DIAGONAL = [166, 227, 255]; // lighter blue #A6E3FF
  const DOT = [240, 250, 255];

  const set = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const o = (y * S + x) * 4;
    buf[o] = rgb[0];
    buf[o + 1] = rgb[1];
    buf[o + 2] = rgb[2];
    buf[o + 3] = 255;
  };

  // Rounded-rect background with vertical navy gradient.
  const pad = 8 * SS;
  const r = 44 * SS;
  const x0 = pad;
  const y0 = pad;
  const x1 = S - pad;
  const y1 = S - pad;
  const insideRoundRect = (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
    const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
  for (let y = 0; y < S; y++) {
    const t = (y - y0) / (y1 - y0);
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    const rgb = [
      Math.round(NAVY_TOP[0] + (NAVY_BOTTOM[0] - NAVY_TOP[0]) * tc),
      Math.round(NAVY_TOP[1] + (NAVY_BOTTOM[1] - NAVY_TOP[1]) * tc),
      Math.round(NAVY_TOP[2] + (NAVY_BOTTOM[2] - NAVY_TOP[2]) * tc),
    ];
    for (let x = 0; x < S; x++) {
      if (insideRoundRect(x, y)) set(x, y, rgb);
    }
  }

  // Thick line segment (stroke) drawn opaque over the background.
  const drawLine = (ax, ay, bx, by, halfW, rgb) => {
    const minX = Math.floor(Math.min(ax, bx) - halfW - 1);
    const maxX = Math.ceil(Math.max(ax, bx) + halfW + 1);
    const minY = Math.floor(Math.min(ay, by) - halfW - 1);
    const maxY = Math.ceil(Math.max(ay, by) + halfW + 1);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + t * dx;
        const py = ay + t * dy;
        const ddx = x - px;
        const ddy = y - py;
        if (ddx * ddx + ddy * ddy <= halfW * halfW) set(x, y, rgb);
      }
    }
  };

  const filledCircle = (cx, cy, rad, rgb) => {
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
        const ddx = x - cx;
        const ddy = y - cy;
        if (ddx * ddx + ddy * ddy <= rad * rad) set(x, y, rgb);
      }
    }
  };

  const c = 128 * SS;
  const v = 76 * SS; // center→vertex
  const top = [c, c - v];
  const right = [c + v, c];
  const bottom = [c, c + v];
  const left = [c - v, c];

  // Vickers indentation diamond (square rotated 45°).
  const edgeW = 5 * SS;
  drawLine(top[0], top[1], right[0], right[1], edgeW, DIAMOND);
  drawLine(right[0], right[1], bottom[0], bottom[1], edgeW, DIAMOND);
  drawLine(bottom[0], bottom[1], left[0], left[1], edgeW, DIAMOND);
  drawLine(left[0], left[1], top[0], top[1], edgeW, DIAMOND);

  // Measurement diagonals (d1 / d2) forming the crosshair.
  const diagW = 2.5 * SS;
  drawLine(top[0], top[1], bottom[0], bottom[1], diagW, DIAGONAL);
  drawLine(left[0], left[1], right[0], right[1], diagW, DIAGONAL);

  // Center crosshair dot.
  filledCircle(c, c, 7 * SS, DOT);

  return buf;
}

// Box-downsample the supersampled master to `size`, alpha-weighting RGB so the
// rounded-corner / diamond edges anti-alias cleanly against transparency.
function downscale(master, size) {
  const out = Buffer.alloc(size * size * 4, 0);
  const block = S / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let saWeighted = 0;
      let saSum = 0;
      let n = 0;
      const sx0 = Math.floor(x * block);
      const sy0 = Math.floor(y * block);
      const sx1 = Math.floor((x + 1) * block);
      const sy1 = Math.floor((y + 1) * block);
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * S + sx) * 4;
          const a = master[o + 3];
          sr += master[o] * a;
          sg += master[o + 1] * a;
          sb += master[o + 2] * a;
          saWeighted += a;
          saSum += a;
          n++;
        }
      }
      const o = (y * size + x) * 4;
      if (saWeighted > 0) {
        out[o] = Math.round(sr / saWeighted);
        out[o + 1] = Math.round(sg / saWeighted);
        out[o + 2] = Math.round(sb / saWeighted);
      }
      out[o + 3] = Math.round(saSum / (n || 1));
    }
  }
  return out;
}

/* -------------------------------- main ---------------------------------- */

function main() {
  const master = makeMaster();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => ({ size, png: encodePNG(size, size, downscale(master, size)) }));

  const ico = buildICO(images);
  const png256 = images.find((i) => i.size === 256).png;

  const buildDir = path.join(ROOT, 'build');
  const publicDir = path.join(ROOT, 'frontend', 'public');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png256);
  fs.writeFileSync(path.join(publicDir, 'app-icon.png'), png256);

  // eslint-disable-next-line no-console
  console.log(
    `[generate-app-icon] wrote build/icon.ico (${ico.length} bytes, sizes ${sizes.join('/')}), build/icon.png, frontend/public/app-icon.png`
  );
}

main();
