const assert = require('assert');
const { buildScanCandidates, findAsciiReading } = require('./micrometerService');

const candidates = buildScanCandidates('COM3');

assert.ok(candidates.length > 1);
assert.deepStrictEqual(candidates[0], {
  path: 'COM3',
  baudRate: 2300,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  pulseMode: 'alternate-high',
});
assert.ok(candidates.some((candidate) => candidate.baudRate === 2300 && candidate.pulseMode === 'rts-high'));
assert.ok(candidates.some((candidate) => candidate.baudRate === 9600 && candidate.pulseMode === 'none'));

for (const candidate of candidates) {
  assert.strictEqual(candidate.path, 'COM3');
  assert.strictEqual(candidate.dataBits, 8);
  assert.strictEqual(candidate.parity, 'none');
  assert.strictEqual(candidate.stopBits, 1);
}

{
  const found = findAsciiReading(
    Buffer.from('20 20 20 30 2c 38 32 30 0d 08'.replace(/\s+/g, ''), 'hex')
  );
  assert.ok(found);
  assert.strictEqual(found.ascii, '0.820');
  assert.strictEqual(found.value, 0.82);
}

{
  const found = findAsciiReading(Buffer.from('+0.820 mm\r\n'));
  assert.ok(found);
  assert.strictEqual(found.ascii, '+0.820');
  assert.strictEqual(found.value, 0.82);
}

console.log('[micrometer][service-test] passed');
