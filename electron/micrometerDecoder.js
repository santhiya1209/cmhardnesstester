const BINARY_FRAME_LENGTH = 10;
const SYNC_FRAME_LEN = BINARY_FRAME_LENGTH;
const SYNC_BYTES = [0x00, 0x00, 0x20];
const DIGIT_NIBBLE_INDEXES = [5, 6, 7, 8];
const DEFAULT_DECIMAL_PLACES = 3;

function bufferToHex(buffer) {
  return Array.from(buffer.values())
    .map((value) => value.toString(16).padStart(2, '0'))
    .join(' ');
}

function bufferToByteTable(buffer) {
  return Array.from(buffer).map((byte, idx) => ({
    i: idx,
    hex: byte.toString(16).padStart(2, '0'),
    dec: byte,
    high: (byte >> 4) & 0x0f,
    low: byte & 0x0f,
  }));
}

function formatDisplayValue(value) {
  const sign = value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(DEFAULT_DECIMAL_PLACES)} mm`;
}

function getDecimalPlaces(frame) {
  const decimalHint = frame[4] & 0x0f;
  if (decimalHint >= 0x00 && decimalHint <= 0x04) {
    return decimalHint;
  }
  if (decimalHint === 0x0c) {
    return DEFAULT_DECIMAL_PLACES;
  }
  return DEFAULT_DECIMAL_PLACES;
}

function validateBinaryMicrometerFrame(frame) {
  const rawHex = Buffer.isBuffer(frame) ? bufferToHex(frame) : '';

  if (!Buffer.isBuffer(frame)) {
    return { ok: false, reason: 'not-a-buffer', rawHex };
  }

  if (frame.length !== BINARY_FRAME_LENGTH) {
    return {
      ok: false,
      reason: `invalid-length:${frame.length}`,
      rawHex,
    };
  }

  if (frame[0] !== 0x00) {
    return { ok: false, reason: 'invalid-sync-byte-0', rawHex };
  }

  if (frame[1] !== 0x00) {
    return { ok: false, reason: 'invalid-sync-byte-1', rawHex };
  }

  if (frame[2] !== 0x20) {
    return { ok: false, reason: 'invalid-sync-byte-2', rawHex };
  }

  if (frame[9] !== 0x00) {
    return { ok: false, reason: 'invalid-terminator-byte-9', rawHex };
  }

  if ((frame[3] & 0xf0) !== 0x20) {
    return { ok: false, reason: 'invalid-frame-marker-byte-3', rawHex };
  }

  for (const index of DIGIT_NIBBLE_INDEXES) {
    if ((frame[index] & 0x0f) > 9) {
      return {
        ok: false,
        reason: `invalid-bcd-nibble-${index}`,
        rawHex,
      };
    }
  }

  return { ok: true, reason: 'valid', rawHex };
}

function isLikelyBinaryMicrometerFrame(frame) {
  return validateBinaryMicrometerFrame(frame).ok;
}

function parseBinaryMicrometerFrame(frame) {
  const validation = validateBinaryMicrometerFrame(frame);
  if (!validation.ok) {
    return null;
  }

  const sign = (frame[3] & 0x0f) === 0x01 ? -1 : 1;
  const leadingDigit = (frame[2] >> 4) & 0x0f;
  const decimalPlaces = getDecimalPlaces(frame);
  const digits = DIGIT_NIBBLE_INDEXES.map((index) => frame[index] & 0x0f);
  const numeric =
    leadingDigit * 10000 +
    digits[0] * 1000 +
    digits[1] * 100 +
    digits[2] * 10 +
    digits[3];
  const value = sign * (numeric / 10 ** decimalPlaces);

  return {
    rawHex: validation.rawHex,
    raw: validation.rawHex,
    value,
    displayValue: formatDisplayValue(value),
    decimalPlaces,
    unit: 'mm',
    sign: sign < 0 ? '-' : '+',
    digits: [leadingDigit, ...digits],
  };
}

function indexOfSync(buffer, fromIndex = 0) {
  for (let i = fromIndex; i + SYNC_BYTES.length <= buffer.length; i += 1) {
    if (
      buffer[i] === SYNC_BYTES[0] &&
      buffer[i + 1] === SYNC_BYTES[1] &&
      buffer[i + 2] === SYNC_BYTES[2]
    ) {
      return i;
    }
  }
  return -1;
}

function parseBinaryFrames(buffer) {
  const frames = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = indexOfSync(buffer, cursor);
    if (start === -1) {
      cursor = Math.max(cursor, buffer.length - (SYNC_BYTES.length - 1));
      break;
    }

    if (start + BINARY_FRAME_LENGTH > buffer.length) {
      cursor = start;
      break;
    }

    const candidate = Buffer.from(buffer.subarray(start, start + BINARY_FRAME_LENGTH));
    const validation = validateBinaryMicrometerFrame(candidate);
    if (!validation.ok) {
      cursor = start + 1;
      continue;
    }

    frames.push(candidate);
    cursor = start + BINARY_FRAME_LENGTH;
  }

  const leftover = cursor < buffer.length ? Buffer.from(buffer.subarray(cursor)) : Buffer.alloc(0);
  return { frames, leftover };
}

function diagnoseChineseFrame(frame) {
  const validation = validateBinaryMicrometerFrame(frame);
  return {
    ok: validation.ok,
    reason: validation.reason,
    rawHex: validation.rawHex,
    length: Buffer.isBuffer(frame) ? frame.length : 0,
    bytes: Buffer.isBuffer(frame) ? bufferToByteTable(frame) : [],
  };
}

function decodeMicrometerBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  const { frames } = parseBinaryFrames(buffer);
  if (frames.length === 0) {
    return null;
  }

  return parseBinaryMicrometerFrame(frames[frames.length - 1]);
}

const parseChineseFrames = parseBinaryFrames;
const decodeChineseFrame = parseBinaryMicrometerFrame;

// Frame-shape detector for the unknown 10-byte preamble seen on COM3:
//   20 00 [00|20] 20 0c [d] [d] [d] 08 00
// The strict decoder above rejects this layout. We use this detector only to
// align candidate 10-byte slices that can then be passed to the captures.js
// learning decoder — we do NOT speculate which nibbles hold the digits.
const ALT_FRAME_LENGTH = 10;

function isAlternatePreambleFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length !== ALT_FRAME_LENGTH) return false;
  if (frame[0] !== 0x20) return false;
  if (frame[1] !== 0x00) return false;
  if (frame[3] !== 0x20) return false;
  if ((frame[4] & 0x0f) !== 0x0c) return false;
  if (frame[8] !== 0x08) return false;
  if (frame[9] !== 0x00) return false;
  return true;
}

// Best-effort interpretation for the alt-preamble layout. Frame bytes 0,1,3,
// 4,8,9 are constant on every observed frame, so the value sits in bytes 2,
// 5, 6, 7. Treat byte-2 high nibble as the leading integer digit and the low
// nibbles of bytes 5/6/7 as the three decimal digits. Decimal hint = byte 4
// low nibble = 0x0c → 3 decimal places. If your LCD does not match, log the
// frame hex + the LCD value you see — we shift nibble positions accordingly.
function parseAlternatePreambleFrame(frame) {
  if (!isAlternatePreambleFrame(frame)) return null;
  const decimalPlaces = 3;
  const leading = (frame[2] >> 4) & 0x0f;
  const d1 = frame[5] & 0x0f;
  const d2 = frame[6] & 0x0f;
  const d3 = frame[7] & 0x0f;
  if ([leading, d1, d2, d3].some((d) => d > 9)) return null;
  const numeric = leading * 1000 + d1 * 100 + d2 * 10 + d3;
  const value = numeric / 10 ** decimalPlaces;
  const rawHex = bufferToHex(frame);
  return {
    rawHex,
    raw: rawHex,
    value,
    displayValue: formatDisplayValue(value),
    decimalPlaces,
    unit: 'mm',
    sign: '+',
    digits: [leading, d1, d2, d3],
  };
}

function parseAlternatePreambleFrames(buffer) {
  const frames = [];
  let cursor = 0;
  while (cursor + ALT_FRAME_LENGTH <= buffer.length) {
    const candidate = Buffer.from(buffer.subarray(cursor, cursor + ALT_FRAME_LENGTH));
    if (isAlternatePreambleFrame(candidate)) {
      frames.push(candidate);
      cursor += ALT_FRAME_LENGTH;
    } else {
      cursor += 1;
    }
  }
  const leftover =
    cursor < buffer.length ? Buffer.from(buffer.subarray(cursor)) : Buffer.alloc(0);
  return { frames, leftover };
}

module.exports = {
  ALT_FRAME_LENGTH,
  BINARY_FRAME_LENGTH,
  SYNC_FRAME_LEN,
  bufferToHex,
  bufferToByteTable,
  decodeChineseFrame,
  decodeMicrometerBuffer,
  diagnoseChineseFrame,
  formatDisplayValue,
  isAlternatePreambleFrame,
  isLikelyBinaryMicrometerFrame,
  parseAlternatePreambleFrame,
  parseAlternatePreambleFrames,
  parseBinaryFrames,
  parseBinaryMicrometerFrame,
  parseChineseFrames,
  validateBinaryMicrometerFrame,
};
