const assert = require('assert');
const { buildScanCandidates, findAsciiReading } = require('./micrometerService');

const candidates = buildScanCandidates('COM3');

assert.deepStrictEqual(
  candidates.map((candidate) => candidate.baudRate),
  [2300]
);

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

console.log('[micrometer][service-test] passed');
