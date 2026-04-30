// Captures store + decoder fitter for the unknown Chinese micrometer protocol.
//
// We refuse to invent a decoder. Instead this module reads pairs of
// (LCD value, raw 10-byte frame hex) from a JSON file and *learns* the
// per-byte digit mapping by inspecting nibbles that vary between samples
// in lockstep with the LCD value.
//
// File location:
//   - dev:  <repo>/electron/micrometer-captures.json
//   - prod: <userData>/micrometer-captures.json (Electron app.getPath('userData'))
//
// File shape:
//   {
//     "pairs": [
//       { "lcd": 27.791, "hex": "00 00 20 27 0c 26 30 21 09 00" },
//       { "lcd": 28.160, "hex": "00 00 20 30 0c 20 24 20 08 00" },
//       ...
//     ]
//   }
//
// Decoder activation:
//   - 0 pairs: every frame returns null (UI shows "Waiting for valid frame").
//   - 1 pair:  exact-match only. Same hex → returns that LCD; anything else null.
//   - 2+ pairs: try to fit a digit-position model. If every captured pair is
//               reproduced exactly, the model is used for new frames. If the
//               model can't fit all captures, decoder returns null until
//               more samples are added.

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'micrometer-captures.json';
const FRAME_LEN = 10;

function captureFilePath(app) {
  if (app && app.isPackaged) {
    return path.join(app.getPath('userData'), FILE_NAME);
  }
  return path.join(__dirname, FILE_NAME);
}

function ensureFileExists(filePath) {
  if (fs.existsSync(filePath)) return;
  const seed = {
    _comment:
      'Add LCD/hex pairs as you capture them. Each "hex" must be a 10-byte frame as logged by [micrometer][frame-complete]. Decoder activates with 2+ pairs and only if it can reproduce every pair exactly.',
    pairs: [],
  };
  fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), 'utf8');
}

function hexToBuffer(hex) {
  return Buffer.from(String(hex).replace(/\s+/g, ''), 'hex');
}

function readPairs(filePath) {
  ensureFileExists(filePath);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed && parsed.pairs) ? parsed.pairs : [];
  const valid = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const lcd = Number(entry.lcd);
    if (!Number.isFinite(lcd)) continue;
    const buf = hexToBuffer(entry.hex || '');
    if (buf.length !== FRAME_LEN) continue;
    valid.push({ lcd, hex: Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' '), buf });
  }
  return valid;
}

// Try to fit a per-byte BCD model: for each (high|low) nibble at indices 3..8,
// determine if that nibble equals the digit at some position of LCD*10^k.
// We accept the model only if the SAME mapping reproduces all captured pairs.
//
// Returns: { decode(frameBuffer) → { value, decimalPlaces } | null, ready: bool, reason: string }
function fitDecoder(pairs) {
  if (pairs.length === 0) {
    return { decode: () => null, ready: false, reason: 'no-pairs' };
  }
  if (pairs.length === 1) {
    const only = pairs[0];
    return {
      decode: (frame) => {
        if (Buffer.compare(frame, only.buf) === 0) {
          const decimalPlaces = decimalPlacesOf(only.lcd);
          return { value: only.lcd, decimalPlaces };
        }
        return null;
      },
      ready: false,
      reason: 'one-pair-exact-only',
    };
  }

  // Encode each LCD as a 5-digit integer (3 decimal places) so positions are
  // stable across samples: 27.791 → 27791, 28.160 → 28160.
  const encoded = pairs.map((p) => ({
    pair: p,
    digits: lcdToDigits(p.lcd, 5, 3),
  }));

  // Candidate "sources" for each digit position: for each frame byte index
  // 3..8, both high and low nibbles. 12 candidates per digit position.
  const SOURCES = [];
  for (const idx of [3, 5, 6, 7, 8]) {
    SOURCES.push({ key: `${idx}H`, get: (frame) => (frame[idx] >> 4) & 0x0f });
    SOURCES.push({ key: `${idx}L`, get: (frame) => frame[idx] & 0x0f });
  }

  // For each LCD digit position 0..4, find the source nibble whose value
  // matches that digit on EVERY captured frame.
  const digitSources = [];
  for (let dPos = 0; dPos < 5; dPos += 1) {
    const matches = SOURCES.filter((src) =>
      encoded.every(({ pair, digits }) => src.get(pair.buf) === digits[dPos])
    );
    if (matches.length === 0) {
      return {
        decode: () => null,
        ready: false,
        reason: `no-source-fits-digit-${dPos}`,
      };
    }
    digitSources.push(matches[0]); // pick the first; any is fine if it fits all
  }

  // Sanity check: full reconstruction.
  for (const { pair, digits } of encoded) {
    for (let dPos = 0; dPos < 5; dPos += 1) {
      if (digitSources[dPos].get(pair.buf) !== digits[dPos]) {
        return { decode: () => null, ready: false, reason: 'self-check-failed' };
      }
    }
  }

  return {
    decode: (frame) => {
      const digits = digitSources.map((src) => src.get(frame));
      if (digits.some((d) => d > 9)) return null;
      const numeric = digits.reduce((acc, d) => acc * 10 + d, 0);
      return { value: numeric / 1000, decimalPlaces: 3 };
    },
    ready: true,
    reason: `fit-ok via ${digitSources.map((s) => s.key).join(',')}`,
  };
}

function lcdToDigits(lcd, totalDigits, decimalPlaces) {
  const scaled = Math.round(Math.abs(lcd) * 10 ** decimalPlaces);
  const out = new Array(totalDigits).fill(0);
  let n = scaled;
  for (let i = totalDigits - 1; i >= 0; i -= 1) {
    out[i] = n % 10;
    n = Math.floor(n / 10);
  }
  return out;
}

function decimalPlacesOf(value) {
  const m = /\.(\d+)/.exec(String(value));
  return m ? m[1].length : 0;
}

function loadCaptures(app) {
  const filePath = captureFilePath(app);
  const pairs = readPairs(filePath);
  const fitted = fitDecoder(pairs);
  return { filePath, pairs, ...fitted };
}

module.exports = {
  FILE_NAME,
  FRAME_LEN,
  captureFilePath,
  fitDecoder,
  hexToBuffer,
  loadCaptures,
  readPairs,
};
