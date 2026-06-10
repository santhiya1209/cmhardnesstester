import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildZFrame,
  buildZLockCommand,
  buildZLoosenCommand,
  buildZJogUpCommand,
  buildZJogDownCommand,
  buildZMoveUpCommand,
  buildZMoveDownCommand,
  buildZSetSpeedCommand,
  buildZMoveCommand,
  buildZJogCommand,
  classifyZLine,
  normalizeZLine,
  replyMatchesExpect,
  resolveZSign,
  splitZLines,
  zMmToPulses,
  zSpeedRegisterValue,
  Z_SPEED_REGISTER_VALUES,
} from './z-axis-protocol';

const ascii = (s: string): Buffer => Buffer.from(s, 'ascii');

// --- buildZFrame: pure "#payload#" wrapper, no checksum ---------------------
test('buildZFrame wraps a payload in #...# with no checksum', () => {
  assert.equal(buildZFrame('LK'), '#LK#');
  assert.equal(buildZFrame('+Z 15'), '#+Z 15#');
  assert.equal(buildZFrame(''), '##');
});

// --- Each command builder: exact visible string + on-wire bytes -------------
test('lock builds #LK# and expects OK_LK', () => {
  const cmd = buildZLockCommand();
  assert.equal(cmd.visible, '#LK#');
  assert.deepEqual(cmd.frame, ascii('#LK#'));
  assert.equal(cmd.expect, 'OK_LK');
});

test('loosen builds #LS# and expects OK_LS', () => {
  const cmd = buildZLoosenCommand();
  assert.equal(cmd.visible, '#LS#');
  assert.deepEqual(cmd.frame, ascii('#LS#'));
  assert.equal(cmd.expect, 'OK_LS');
});

test('jog up builds #+S# and expects SOK', () => {
  const cmd = buildZJogUpCommand();
  assert.equal(cmd.visible, '#+S#');
  assert.deepEqual(cmd.frame, ascii('#+S#'));
  assert.equal(cmd.expect, 'SOK');
});

test('jog down builds #-S# and expects SOK', () => {
  const cmd = buildZJogDownCommand();
  assert.equal(cmd.visible, '#-S#');
  assert.deepEqual(cmd.frame, ascii('#-S#'));
  assert.equal(cmd.expect, 'SOK');
});

test('step move up/down keep a LITERAL space between Z and pulses; magnitude only', () => {
  assert.equal(buildZMoveUpCommand(15).visible, '#+Z 15#');
  assert.equal(buildZMoveDownCommand(15).visible, '#-Z 15#');
  // magnitude only — a negative input is never written as a negative number.
  assert.equal(buildZMoveUpCommand(-15).visible, '#+Z 15#');
  assert.deepEqual(buildZMoveUpCommand(15).frame, ascii('#+Z 15#'));
  assert.equal(buildZMoveUpCommand(15).expect, '>Z:');
  assert.equal(buildZMoveDownCommand(15).expect, '>Z:');
});

test('set speed builds #VZnnnn# with NO space and expects OK_ZFinalSpeed', () => {
  const cmd = buildZSetSpeedCommand(1000);
  assert.equal(cmd.visible, '#VZ1000#');
  assert.deepEqual(cmd.frame, ascii('#VZ1000#'));
  assert.equal(cmd.expect, 'OK_ZFinalSpeed');
});

test('sign-dispatch builders pick up/down correctly', () => {
  assert.equal(buildZMoveCommand('+', 15).visible, '#+Z 15#');
  assert.equal(buildZMoveCommand('-', 15).visible, '#-Z 15#');
  assert.equal(buildZJogCommand('+').visible, '#+S#');
  assert.equal(buildZJogCommand('-').visible, '#-S#');
});

// --- No checksum anywhere on the wire ---------------------------------------
test('no command frame carries a checksum byte (0x21 "!" or trailing digits)', () => {
  for (const cmd of [
    buildZLockCommand(),
    buildZLoosenCommand(),
    buildZJogUpCommand(),
    buildZJogDownCommand(),
    buildZMoveUpCommand(15),
    buildZMoveDownCommand(15),
    buildZSetSpeedCommand(1000),
  ]) {
    // Frame is exactly "#...#": starts and ends with '#', no '!' checksum delimiter.
    assert.ok(cmd.visible.startsWith('#') && cmd.visible.endsWith('#'), cmd.visible);
    assert.ok(!cmd.visible.includes('!'), cmd.visible);
  }
});

// --- reverseDirection mapping -----------------------------------------------
test('resolveZSign maps up→+/down→- and swaps when reversed', () => {
  assert.equal(resolveZSign('up', false), '+');
  assert.equal(resolveZSign('down', false), '-');
  assert.equal(resolveZSign('up', true), '-');
  assert.equal(resolveZSign('down', true), '+');
});

// --- mm → pulses ------------------------------------------------------------
test('zMmToPulses rounds mm*pulsePerMm', () => {
  assert.equal(zMmToPulses(0.001, 15000), 15);
  assert.equal(zMmToPulses(1, 15000), 15000);
  assert.equal(zMmToPulses(0.0005, 15000), 8); // 7.5 → 8
});

test('focus-mode step sizes: FFocus 0.001mm→15 pulses, CFocus 0.010mm→150 pulses', () => {
  assert.equal(zMmToPulses(0.001, 15000), 15); // FFocus fine step
  assert.equal(zMmToPulses(0.01, 15000), 150); // CFocus coarse step
});

// --- speed register config --------------------------------------------------
test('speed register values are ordered slow < fast < ultra', () => {
  assert.ok(Z_SPEED_REGISTER_VALUES.slow < Z_SPEED_REGISTER_VALUES.fast);
  assert.ok(Z_SPEED_REGISTER_VALUES.fast < Z_SPEED_REGISTER_VALUES.ultra);
  assert.equal(zSpeedRegisterValue('fast'), Z_SPEED_REGISTER_VALUES.fast);
});

// --- LF line parser: split on LF ONLY, tolerate stray CR --------------------
test('splitZLines splits on LF only and buffers the trailing partial line', () => {
  const { lines, rest } = splitZLines('OK_LK\nSOK\n>Z:12');
  assert.deepEqual(lines, ['OK_LK', 'SOK']);
  assert.equal(rest, '>Z:12'); // no trailing LF yet → kept as remainder
});

test('splitZLines does NOT split on a bare CR (LF is the only terminator)', () => {
  const { lines, rest } = splitZLines('UP\rSOK\n');
  assert.deepEqual(lines, ['UP\rSOK']);
  assert.equal(rest, '');
});

test('normalizeZLine trims a trailing CR (CRLF tolerance) and whitespace', () => {
  assert.equal(normalizeZLine('OK_LK\r'), 'OK_LK');
  assert.equal(normalizeZLine('  UP  '), 'UP');
});

// --- substring matching, NOT exact/checksum ---------------------------------
test('replyMatchesExpect matches by SUBSTRING for each token', () => {
  assert.equal(replyMatchesExpect('OK_LK', 'OK_LK'), true);
  assert.equal(replyMatchesExpect('OK_LS', 'OK_LS'), true);
  assert.equal(replyMatchesExpect('SOK', 'SOK'), true);
  assert.equal(replyMatchesExpect('UP', 'UP'), true);
  assert.equal(replyMatchesExpect('OK_ZFinalSpeed', 'OK_ZFinalSpeed'), true);
  // controller may append extra characters — substring still matches.
  assert.equal(replyMatchesExpect('>Z:12345', '>Z:'), true);
  assert.equal(replyMatchesExpect('SOK done', 'SOK'), true);
});

test('replyMatchesExpect rejects a non-matching reply (never fake success)', () => {
  assert.equal(replyMatchesExpect('SOK', 'UP'), false); // jog ack ≠ stop ack
  assert.equal(replyMatchesExpect('OK_LK', 'OK_LS'), false);
  assert.equal(replyMatchesExpect('WAT?', '>Z:'), false);
});

test('replyMatchesExpect with "any" accepts any line (probe)', () => {
  assert.equal(replyMatchesExpect('anything', 'any'), true);
  assert.equal(replyMatchesExpect('', 'any'), true);
});

test('classifyZLine labels lines for diagnostics', () => {
  assert.equal(classifyZLine('OK_LK'), 'ack');
  assert.equal(classifyZLine('OK_ZFinalSpeed'), 'ack');
  assert.equal(classifyZLine('SOK'), 'status');
  assert.equal(classifyZLine('UP'), 'status');
  assert.equal(classifyZLine('>Z:42'), 'status');
  assert.equal(classifyZLine('ERROR'), 'error');
  assert.equal(classifyZLine('???'), 'unknown');
});
