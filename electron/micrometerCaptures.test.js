const assert = require('assert');
const { fitDecoder, hexToBuffer } = require('./micrometerCaptures');

function pair(lcd, hex) {
  return { lcd, hex, buf: hexToBuffer(hex) };
}

// 0 pairs → never decodes.
{
  const fit = fitDecoder([]);
  assert.strictEqual(fit.ready, false);
  assert.strictEqual(fit.decode(hexToBuffer('00 00 20 27 0c 26 30 21 09 00')), null);
}

// 1 pair → exact match only, never extrapolates.
{
  const only = pair(27.791, '00 00 20 27 0c 26 30 21 09 00');
  const fit = fitDecoder([only]);
  assert.strictEqual(fit.ready, false);
  const same = fit.decode(only.buf);
  assert.ok(same && Math.abs(same.value - 27.791) < 1e-9);
  const different = fit.decode(hexToBuffer('00 00 20 30 0c 20 24 20 08 00'));
  assert.strictEqual(different, null);
}

// 2 pairs that don't fit any single digit-source mapping → not ready.
// The two real-world pairs do not share enough digit overlap to fit; the
// decoder must refuse, not invent.
{
  const fit = fitDecoder([
    pair(27.791, '00 00 20 27 0c 26 30 21 09 00'),
    pair(28.160, '00 00 20 30 0c 20 24 20 08 00'),
  ]);
  assert.strictEqual(fit.ready, false, 'must not invent a model when no source nibble fits both pairs');
  // Exact-match fallback also off — no decode for either captured pair.
  assert.strictEqual(fit.decode(hexToBuffer('00 00 20 27 0c 26 30 21 09 00')), null);
}

// Synthetic pairs that DO fit a clean BCD layout: high-nibble of byte[5..8]
// + (frame[2] high) hold the digits. This mirrors what we expect to see once
// real captures arrive that obey a consistent rule.
{
  function frame(d0, d1, d2, d3, d4) {
    // Synthetic protocol: digits live in the high nibble of bytes 3,5,6,7,8.
    const buf = Buffer.from([
      0x00,
      0x00,
      0x20,
      (d0 << 4) | 0x0,
      0x0c,
      (d1 << 4) | 0x0,
      (d2 << 4) | 0x0,
      (d3 << 4) | 0x0,
      (d4 << 4) | 0x0,
      0x00,
    ]);
    return buf;
  }
  const samples = [
    { lcd: 12.345, hex: bufHex(frame(1, 2, 3, 4, 5)) },
    { lcd: 67.890, hex: bufHex(frame(6, 7, 8, 9, 0)) },
    { lcd: 5.001, hex: bufHex(frame(0, 5, 0, 0, 1)) },
  ];
  const fit = fitDecoder(samples.map((s) => ({ ...s, buf: hexToBuffer(s.hex) })));
  assert.strictEqual(fit.ready, true, 'fitter must lock onto a clean model: ' + fit.reason);
  for (const s of samples) {
    const out = fit.decode(hexToBuffer(s.hex));
    assert.ok(out, `fit.decode should return a value for ${s.lcd}`);
    assert.ok(Math.abs(out.value - s.lcd) < 1e-9, `decoded ${out.value} should equal ${s.lcd}`);
  }
}

function bufHex(buf) {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

console.log('[micrometer][captures-test] passed');
