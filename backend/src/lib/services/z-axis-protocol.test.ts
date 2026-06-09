import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLockZCommand,
  buildUnlockZCommand,
  buildSetZSpeedCommand,
  buildMoveZCommand,
  buildJogZCommand,
  buildPollZStatusCommand,
  parseZReply,
  replyMatchesExpect,
  resolveZSign,
  zMmToPulses,
  zSpeedRegisterValue,
  Z_SPEED_REGISTER_VALUES,
} from './z-axis-protocol';

const ascii = (s: string): Buffer => Buffer.from(s, 'ascii');

// --- TX builders: exact visible string + on-wire bytes (no checksum) --------
test('lock/unlock/poll build the exact "#...#" frames', () => {
  assert.equal(buildLockZCommand().visible, '#LK#');
  assert.deepEqual(buildLockZCommand().frame, ascii('#LK#'));
  assert.equal(buildLockZCommand().ackToken, 'OK_LK');

  assert.equal(buildUnlockZCommand().visible, '#LS#');
  assert.equal(buildUnlockZCommand().ackToken, 'OK_LS');

  assert.equal(buildPollZStatusCommand().visible, '#sss#');
  assert.equal(buildPollZStatusCommand().expect, 'status');
});

test('set speed builds #VZnnnn# and expects OK_ZFinalSpeed', () => {
  const cmd = buildSetZSpeedCommand(1000);
  assert.equal(cmd.visible, '#VZ1000#');
  assert.deepEqual(cmd.frame, ascii('#VZ1000#'));
  assert.equal(cmd.ackToken, 'OK_ZFinalSpeed');
});

test('relative move keeps the LITERAL space and magnitude (sign pre-resolved)', () => {
  assert.equal(buildMoveZCommand('+', 15).visible, '#+Z 15#');
  assert.equal(buildMoveZCommand('-', 15).visible, '#-Z 15#');
  // magnitude only — the sign argument is authoritative, never a negative number.
  assert.equal(buildMoveZCommand('+', -15).visible, '#+Z 15#');
  assert.deepEqual(buildMoveZCommand('+', 15).frame, ascii('#+Z 15#'));
  assert.equal(buildMoveZCommand('+', 15).expect, 'status');
});

test('continuous jog builds #+S#/#-S# and expects no reply', () => {
  assert.equal(buildJogZCommand('+').visible, '#+S#');
  assert.equal(buildJogZCommand('-').visible, '#-S#');
  assert.equal(buildJogZCommand('+').expect, 'none');
});

// --- reverseDirection mapping -----------------------------------------------
test('resolveZSign maps up→+/down→- and swaps when reversed', () => {
  assert.equal(resolveZSign('up', false), '+');
  assert.equal(resolveZSign('down', false), '-');
  assert.equal(resolveZSign('up', true), '-');
  assert.equal(resolveZSign('down', true), '+');
});

// --- mm → pulses (15000 pulses/mm; 0.001 mm = 15 pulses) --------------------
test('zMmToPulses rounds mm*pulsePerMm', () => {
  assert.equal(zMmToPulses(0.001, 15000), 15);
  assert.equal(zMmToPulses(1, 15000), 15000);
  assert.equal(zMmToPulses(0.0005, 15000), 8); // 7.5 → 8
});

// --- speed register config --------------------------------------------------
test('speed register values are ordered slow < fast < ultra', () => {
  assert.ok(Z_SPEED_REGISTER_VALUES.slow < Z_SPEED_REGISTER_VALUES.fast);
  assert.ok(Z_SPEED_REGISTER_VALUES.fast < Z_SPEED_REGISTER_VALUES.ultra);
  assert.equal(zSpeedRegisterValue('fast'), Z_SPEED_REGISTER_VALUES.fast);
});

// --- RX parser --------------------------------------------------------------
test('parseZReply recognises ACK tokens (CRLF-trimmed, case-insensitive)', () => {
  assert.deepEqual(parseZReply('OK_LK\r\n'), { kind: 'ack', token: 'OK_LK', raw: 'OK_LK' });
  assert.deepEqual(parseZReply('ok_ls'), { kind: 'ack', token: 'OK_LS', raw: 'ok_ls' });
  assert.deepEqual(parseZReply('OK_ZFinalSpeed\n'), {
    kind: 'ack',
    token: 'OK_ZFinalSpeed',
    raw: 'OK_ZFinalSpeed',
  });
});

test('parseZReply recognises status words and ERROR; unknown is preserved', () => {
  assert.equal(parseZReply('UP\r\n').kind, 'status');
  assert.equal(parseZReply('STOP').kind, 'status');
  assert.equal(parseZReply('ERROR').kind, 'error');
  assert.equal(parseZReply('ERR').kind, 'error');
  const unknown = parseZReply('WAT?');
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.raw, 'WAT?');
});

test('replyMatchesExpect gates ack token and status, never matches unknown', () => {
  assert.equal(replyMatchesExpect(parseZReply('OK_LK'), 'ack', 'OK_LK'), true);
  assert.equal(replyMatchesExpect(parseZReply('OK_LS'), 'ack', 'OK_LK'), false);
  assert.equal(replyMatchesExpect(parseZReply('UP'), 'status'), true);
  assert.equal(replyMatchesExpect(parseZReply('OK_LK'), 'status'), false);
  assert.equal(replyMatchesExpect(parseZReply('WAT?'), 'status'), false);
});
