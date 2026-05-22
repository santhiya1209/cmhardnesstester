const assert = require('assert');
const {
  BINARY_FRAME_LENGTH,
  bufferToHex,
  decodeChineseFrame,
  formatDisplayValue,
  parseBinaryFrames,
  parseBinaryMicrometerFrame,
  parseChineseFrames,
  validateBinaryMicrometerFrame,
} = require('../micrometerDecoder');

function hexToBuffer(hex) {
  return Buffer.from(hex.replace(/\s+/g, ''), 'hex');
}

const positive29686 = hexToBuffer('00 00 20 20 0c 29 26 28 26 00');
const negative29686 = hexToBuffer('00 00 20 21 0c 29 26 28 26 00');
const noisy2400Frame = hexToBuffer('00 00 20 31 0c 26 24 30 09 00');

assert.strictEqual(BINARY_FRAME_LENGTH, 10);
assert.strictEqual(bufferToHex(positive29686), '00 00 20 20 0c 29 26 28 26 00');

{
  const validation = validateBinaryMicrometerFrame(positive29686);
  assert.strictEqual(validation.ok, true);

  const decoded = parseBinaryMicrometerFrame(positive29686);
  assert.ok(decoded);
  assert.strictEqual(decoded.value, 29.686);
  assert.strictEqual(decoded.displayValue, '29.686 mm');
  assert.deepStrictEqual(decoded.digits, [2, 9, 6, 8, 6]);
}

{
  const decoded = decodeChineseFrame(negative29686);
  assert.ok(decoded);
  assert.strictEqual(decoded.value, -29.686);
  assert.strictEqual(decoded.displayValue, '-29.686 mm');
}

{
  const validation = validateBinaryMicrometerFrame(noisy2400Frame);
  assert.strictEqual(validation.ok, false);
  assert.strictEqual(validation.reason, 'invalid-frame-marker-byte-3');
  assert.strictEqual(parseBinaryMicrometerFrame(noisy2400Frame), null);
}

assert.strictEqual(formatDisplayValue(0), '0.000 mm');
assert.strictEqual(formatDisplayValue(1.2), '1.200 mm');
assert.strictEqual(formatDisplayValue(-1.2), '-1.200 mm');

for (const [label, hex, reason] of [
  ['short', '00 00 20', 'invalid-length:3'],
  ['bad sync 0', '01 00 20 20 0c 29 26 28 26 00', 'invalid-sync-byte-0'],
  ['bad sync 1', '00 01 20 20 0c 29 26 28 26 00', 'invalid-sync-byte-1'],
  ['bad sync 2', '00 00 21 20 0c 29 26 28 26 00', 'invalid-sync-byte-2'],
  ['bad marker', '00 00 20 30 0c 29 26 28 26 00', 'invalid-frame-marker-byte-3'],
  ['bad bcd', '00 00 20 20 0c 29 2a 28 26 00', 'invalid-bcd-nibble-6'],
  ['bad terminator', '00 00 20 20 0c 29 26 28 26 01', 'invalid-terminator-byte-9'],
]) {
  const validation = validateBinaryMicrometerFrame(hexToBuffer(hex));
  assert.strictEqual(validation.ok, false, label);
  assert.strictEqual(validation.reason, reason, label);
  assert.strictEqual(parseBinaryMicrometerFrame(hexToBuffer(hex)), null, label);
}

{
  const parsed = parseBinaryFrames(hexToBuffer('aa bb 00 00 20 20 0c 29 26 28 26 00 cc'));
  assert.strictEqual(parsed.frames.length, 1);
  assert.strictEqual(bufferToHex(parsed.frames[0]), '00 00 20 20 0c 29 26 28 26 00');
  assert.strictEqual(bufferToHex(parsed.leftover), 'cc');
}

{
  const parsed = parseChineseFrames(hexToBuffer('00 00 20 20 0c 29 26'));
  assert.strictEqual(parsed.frames.length, 0);
  assert.strictEqual(bufferToHex(parsed.leftover), '00 00 20 20 0c 29 26');
}

{
  const parsed = parseBinaryFrames(
    hexToBuffer(
      '00 00 20 20 0c 29 26 28 26 00 00 00 20 21 0c 29 26 28 26 00'
    )
  );
  assert.strictEqual(parsed.frames.length, 2);
  assert.strictEqual(parseBinaryMicrometerFrame(parsed.frames[0]).value, 29.686);
  assert.strictEqual(parseBinaryMicrometerFrame(parsed.frames[1]).value, -29.686);
}

console.log('[micrometer][decoder-test] passed');
