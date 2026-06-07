import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLockXyCommand,
  buildUnlockXyCommand,
  buildGetPositionCommand,
  buildStopXyCommand,
  buildSetXBeginSpeedCommand,
  buildSetXAccelerationCommand,
  buildSetXFinalSpeedCommand,
  buildSetYBeginSpeedCommand,
  buildSetYAccelerationCommand,
  buildSetYFinalSpeedCommand,
  buildMoveXCommand,
  buildMoveYCommand,
  buildMoveXyCommand,
  buildHomeCommand,
  parseXyzFrame,
  type XyzBuiltCommand,
} from './xyz-platform-protocol';

const hexUpper = (b: Buffer): string => b.toString('hex').toUpperCase();

// --- Checksum: every HARDWARE-VERIFIED example (Hercules). The checksum byte is
// inserted BEFORE the final '!'; payload = the visible command minus '!'. ------
const CHECKSUM_CASES: Array<[XyzBuiltCommand, string, number]> = [
  [buildLockXyCommand(), '#01!', 0x84],
  [buildUnlockXyCommand(), '#02!', 0x85],
  [buildGetPositionCommand(), '#10!', 0x84],
  [buildStopXyCommand(), '#0B!', 0x95],
  [buildSetXBeginSpeedCommand(1), '#0500000001!', 0x09],
  [buildSetXAccelerationCommand(1), '#0600000001!', 0x0a],
  [buildSetXFinalSpeedCommand(1), '#0700000001!', 0x0b],
  [buildSetYBeginSpeedCommand(1), '#0800000001!', 0x0c],
  [buildSetYAccelerationCommand(1), '#0900000001!', 0x0d],
  [buildSetYFinalSpeedCommand(1), '#0A00000001!', 0x15],
  [buildMoveXCommand(1), '#0C+00000001!', 0x42],
  [buildMoveYCommand(1), '#0E+00000001!', 0x44],
  [buildMoveXyCommand(1, 1), '#11+00000001+00000001!', 0xdd],
  [buildHomeCommand(), '#12!', 0x86],
];

for (const [cmd, visible, expectedChecksum] of CHECKSUM_CASES) {
  test(`checksum ${visible} -> 0x${expectedChecksum.toString(16).toUpperCase().padStart(2, '0')}`, () => {
    const f = cmd.frame;
    assert.equal(cmd.visible, visible);
    assert.equal(f[f.length - 1], 0x21, 'frame must end with "!"');
    assert.equal(f[f.length - 2], expectedChecksum, 'checksum byte before "!" mismatch');
    assert.equal(f.slice(0, -2).toString('latin1'), visible.slice(0, -1), 'payload mismatch');
  });
}

// --- Acceptance: exact full-frame HEX ---------------------------------------
const FULL_HEX: Array<[XyzBuiltCommand, string]> = [
  [buildLockXyCommand(), '2330318421'],
  [buildUnlockXyCommand(), '2330328521'],
  [buildGetPositionCommand(), '2331308421'],
  [buildStopXyCommand(), '2330429521'],
  [buildHomeCommand(), '2331328621'],
  [buildMoveXCommand(1), '2330432B30303030303030314221'],
  [buildMoveYCommand(1), '2330452B30303030303030314421'],
  [buildMoveXyCommand(1, 1), '2331312B30303030303030312B3030303030303031DD21'],
];
for (const [cmd, expected] of FULL_HEX) {
  test(`full hex ${cmd.visible} = ${expected}`, () => {
    assert.equal(hexUpper(cmd.frame), expected);
  });
}

// --- Parser: HARDWARE-VERIFIED replies --------------------------------------
test('parse #01OK -> ack code 01', () => {
  const p = parseXyzFrame('#01OK');
  assert.equal(p.kind, 'ack');
  assert.equal(p.kind === 'ack' && p.code, '01');
});
test('parse #02OK -> ack code 02', () => {
  const p = parseXyzFrame('#02OK');
  assert.equal(p.kind === 'ack' && p.code, '02');
});
test('parse #05OK -> ack code 05', () => {
  const p = parseXyzFrame('#05OK');
  assert.equal(p.kind === 'ack' && p.code, '05');
});
test('parse #05OK<cksum>! -> ack code 05', () => {
  const wire = '#05OK' + String.fromCharCode(0x22) + '!';
  const p = parseXyzFrame(wire);
  assert.equal(p.kind === 'ack' && p.code, '05');
});
test('parse position idle #11:+00040000:+00040000+!', () => {
  const p = parseXyzFrame('#11:+00040000:+00040000+!');
  assert.equal(p.kind, 'position');
  if (p.kind === 'position') {
    assert.equal(p.x, 40000);
    assert.equal(p.y, 40000);
    assert.equal(p.busy, false);
  }
});
test('parse position busy #11:+00040002:+00040002-!', () => {
  const p = parseXyzFrame('#11:+00040002:+00040002-!');
  assert.equal(p.kind, 'position');
  if (p.kind === 'position') {
    assert.equal(p.x, 40002);
    assert.equal(p.y, 40002);
    assert.equal(p.busy, true);
    assert.equal(p.status, '-');
  }
});
test('parse position status "," #11:+00040001:+00040000,!', () => {
  const p = parseXyzFrame('#11:+00040001:+00040000,!');
  assert.equal(p.kind, 'position');
  if (p.kind === 'position') {
    assert.equal(p.x, 40001);
    assert.equal(p.y, 40000);
    assert.equal(p.busy, false); // only '-' is busy; ',' is treated as not-busy
    assert.equal(p.status, ',');
  }
});
test('parse signed position #11:+00012345:-00006789+!', () => {
  const p = parseXyzFrame('#11:+00012345:-00006789+!');
  assert.equal(p.kind === 'position' && p.x, 12345);
  assert.equal(p.kind === 'position' && p.y, -6789);
});
test('parse ERROR -> XYZ_STAGE_PROTOCOL_ERROR', () => {
  const p = parseXyzFrame('ERROR');
  assert.equal(p.kind, 'error');
  assert.equal(p.kind === 'error' && p.error, 'XYZ_STAGE_PROTOCOL_ERROR');
});
