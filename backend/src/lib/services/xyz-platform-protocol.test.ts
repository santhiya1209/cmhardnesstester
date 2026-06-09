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
  buildRelocationMoveCommand,
  buildHomeCommand,
  buildJogMoveCommand,
  isBusyResponseToken,
  isMoveClassCommand,
  normalizeXySpeed,
  parseXyzFrame,
  positionFrameCompletesCommand,
  XY_SPEED_MODES,
  type XyzBuiltCommand,
  type XyzCommandKey,
  type XyzDirection,
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

// --- Relocation command selection: narrowest move per changing axis ---------
test('relocation dx≠0 dy≠0 -> #11 move both', () => {
  const cmd = buildRelocationMoveCommand(100, -50);
  assert.equal(cmd?.key, 'moveXy');
  assert.equal(cmd?.visible, '#11+00000100-00000050!');
});
test('relocation dx≠0 dy=0 -> #0C move X only', () => {
  const cmd = buildRelocationMoveCommand(100, 0);
  assert.equal(cmd?.key, 'moveX');
  assert.equal(cmd?.visible, '#0C+00000100!');
});
test('relocation dx=0 dy≠0 -> #0E move Y only', () => {
  const cmd = buildRelocationMoveCommand(0, -50);
  assert.equal(cmd?.key, 'moveY');
  assert.equal(cmd?.visible, '#0E-00000050!');
});
test('relocation dx=0 dy=0 -> null (no command sent)', () => {
  assert.equal(buildRelocationMoveCommand(0, 0), null);
});

// --- Jog move builder: operator direction → narrowest frame + axis inversion --
// Without inversion the mapping must match the legacy hardcoded signs exactly
// (+x = right, +y = forward/up; left/back negative).
const JOG_NO_INVERT: Array<[XyzDirection, string]> = [
  ['left', '#0C-00000100!'],
  ['right', '#0C+00000100!'],
  ['forward', '#0E+00000100!'],
  ['back', '#0E-00000100!'],
  ['forward-left', '#11-00000100+00000100!'],
  ['forward-right', '#11+00000100+00000100!'],
  ['back-left', '#11-00000100-00000100!'],
  ['back-right', '#11+00000100-00000100!'],
];
for (const [direction, visible] of JOG_NO_INVERT) {
  test(`jog ${direction} (no inversion) -> ${visible}`, () => {
    assert.equal(buildJogMoveCommand(direction, 100).visible, visible);
  });
}

test('jog forward with reverseY flips Y sign (Up moves Y-negative)', () => {
  const cmd = buildJogMoveCommand('forward', 100, { reverseX: false, reverseY: true });
  assert.equal(cmd.key, 'moveY');
  assert.equal(cmd.visible, '#0E-00000100!');
});
test('jog back with reverseY flips Y sign (Down moves Y-positive)', () => {
  assert.equal(buildJogMoveCommand('back', 100, { reverseX: false, reverseY: true }).visible, '#0E+00000100!');
});
test('jog left with reverseX flips X sign', () => {
  assert.equal(buildJogMoveCommand('left', 100, { reverseX: true, reverseY: false }).visible, '#0C+00000100!');
});
test('jog forward-right with reverseY -> #11 x+ y-', () => {
  const cmd = buildJogMoveCommand('forward-right', 100, { reverseX: false, reverseY: true });
  assert.equal(cmd.key, 'moveXy');
  assert.equal(cmd.visible, '#11+00000100-00000100!');
});

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

// --- Settle-gate: move-class completion waits for the IDLE position frame -----
// These encode the rule the service applies at its single completion site
// (handleFrame position branch): a move (#0C/#0E/#11) completes only on an idle
// ('+') frame; every other position consumer completes on the first frame.

// Scenario A — a move command that receives a BUSY position first must NOT complete.
test('settle-gate A: move-class busy frame does NOT complete (#0C/#0E/#11)', () => {
  for (const key of ['moveX', 'moveY', 'moveXy'] as XyzCommandKey[]) {
    assert.equal(isMoveClassCommand(key), true, `${key} is move-class`);
    assert.equal(positionFrameCompletesCommand(key, true), false, `${key} busy -> wait`);
  }
});

// Scenario B — the same move completes once an IDLE position arrives.
test('settle-gate B: move-class idle frame completes the move', () => {
  for (const key of ['moveX', 'moveY', 'moveXy'] as XyzCommandKey[]) {
    assert.equal(positionFrameCompletesCommand(key, false), true, `${key} idle -> resolve`);
  }
});

// Scenario C — getPosition (#10!) resolves on the FIRST frame regardless of busy
// (existing behavior, explicitly preserved).
test('settle-gate C: getPosition completes on first frame even if busy', () => {
  assert.equal(isMoveClassCommand('getPosition'), false);
  assert.equal(positionFrameCompletesCommand('getPosition', true), true);
  assert.equal(positionFrameCompletesCommand('getPosition', false), true);
});

// Non-move consumers (stop/home/lock/speed) are not settle-gated either.
test('settle-gate: stop/home/lock/speed are not move-class (first frame completes)', () => {
  for (const key of [
    'stopXy',
    'home',
    'lockXy',
    'unlockXy',
    'getPosition',
    'setXBeginSpeed',
  ] as XyzCommandKey[]) {
    assert.equal(isMoveClassCommand(key), false, `${key} not move-class`);
    assert.equal(positionFrameCompletesCommand(key, true), true, `${key} completes on first frame`);
  }
});

// Scenario D — ERRt! during a move settle is a transient busy response: recognized,
// never success, and (unlike "ERROR") not a hard protocol error.
test('settle-gate D: ERRt! is a transient busy token, distinct from hard ERROR', () => {
  assert.equal(isBusyResponseToken('ERRt!'), true);
  assert.equal(isBusyResponseToken('ERRt'), true);
  assert.equal(isBusyResponseToken('errt!'), true);
  // Hard ERROR is NOT a busy token and still parses as a hard protocol error.
  assert.equal(isBusyResponseToken('ERROR'), false);
  assert.equal(parseXyzFrame('ERROR').kind, 'error');
  // ERRt! stays 'unknown' at the parser layer — the busy meaning is applied by the
  // service ONLY while a move is settling (handleFrame unknown branch).
  assert.equal(parseXyzFrame('ERRt!').kind, 'unknown');
  // A normal idle position is obviously not a busy token.
  assert.equal(isBusyResponseToken('#11:+00040000:+00040000+!'), false);
});

// XY speed normalization: the four canonical tiers pass through; values from the
// reverted six-tier expansion map back (medium->mid, veryFast/superFast/ultraFast->
// ultra); anything unrecognized is rejected (null).
test('normalizeXySpeed: canonical tiers pass through unchanged', () => {
  for (const mode of XY_SPEED_MODES) {
    assert.equal(normalizeXySpeed(mode), mode);
  }
  assert.deepEqual([...XY_SPEED_MODES], ['slow', 'mid', 'fast', 'ultra']);
});

test('normalizeXySpeed: reverted six-tier values map back to four tiers', () => {
  assert.equal(normalizeXySpeed('medium'), 'mid');
  assert.equal(normalizeXySpeed('veryFast'), 'ultra');
  assert.equal(normalizeXySpeed('superFast'), 'ultra');
  assert.equal(normalizeXySpeed('ultraFast'), 'ultra');
});

test('normalizeXySpeed: unrecognized values return null (no fake mode)', () => {
  assert.equal(normalizeXySpeed('turbo'), null);
  assert.equal(normalizeXySpeed(''), null);
  assert.equal(normalizeXySpeed('Medium'), null);
});
