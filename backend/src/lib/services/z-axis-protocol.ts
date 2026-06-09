// Z-axis motion-stage RS232 protocol adapter.
//
// This is the SINGLE place Z command bytes are built and the SINGLE place Z RX
// replies are parsed. The Z port is operator-selected (Serial Port Setting →
// zPortName) — never hardcoded — and is a SEPARATE physical connection from the
// X/Y stage port and the hardness-machine/turret port.
//
// SOURCE: the legacy ("old software") Z-axis command set shown in the reference
// screen. This is a DIFFERENT controller and a DIFFERENT framing from the X/Y
// stage (which uses the checksum "#xx!" → "#xxOK" protocol in
// xyz-platform-protocol.ts). NOTHING here is shared with the X/Y protocol.
//
// ⚠ NEEDS HARDWARE VERIFICATION: these frames/replies are transcribed from the
// legacy software, not yet confirmed against the live Z controller. The exact
// #VZ speed-register width and the stop behaviour (see Z_JOG_STOP_STRATEGY in the
// service) in particular are unverified. Use diagnoseZ() to confirm on hardware.
//
// TX framing: "#" + payload + "#". Plain ASCII, NO checksum. The visible command
// strings below already include both '#' delimiters, so the on-wire frame is the
// visible string verbatim.
//
// Protocol table (action | tx | expected reply):
//   lock / enable Z   | #LK#         | OK_LK
//   loosen / release  | #LS#         | OK_LS
//   set final speed   | #VZnnnn#     | OK_ZFinalSpeed
//   relative move up  | #+Z nnnn#    | status word (note the LITERAL space)
//   relative move dn  | #-Z nnnn#    | status word (note the LITERAL space)
//   continuous jog up | #+S#         | (continuous motion — no immediate reply)
//   continuous jog dn | #-S#         | (continuous motion — no immediate reply)
//   poll status       | #sss#        | status word (e.g. UP / DOWN / STOP / IDLE)
//
// Replies are plain ASCII words, usually CRLF-terminated. parseZReply trims the
// terminator and classifies; an unrecognised reply is returned as 'unknown'
// (logged by the caller), never silently dropped and never treated as success.

import { Buffer } from 'node:buffer';
import type { ZDirection, ZSpeed } from './xyz-platform-protocol';

export type ZCommandKey =
  | 'lockZ'
  | 'unlockZ'
  | 'setZSpeed'
  | 'moveZ'
  | 'jogZ'
  | 'pollZStatus';

/** What RX a Z command waits for: an ACK token, a status word, or nothing. */
export type ZExpect = 'ack' | 'status' | 'none';

/** Recognised ACK tokens (the only replies that confirm a config command). */
export type ZAckToken = 'OK_LK' | 'OK_LS' | 'OK_ZFinalSpeed';

export interface ZBuiltCommand {
  key: ZCommandKey;
  /** Human-visible command including both '#' delimiters, e.g. "#+Z 15#". */
  visible: string;
  /** Exact bytes written to the wire (the visible string as ASCII). */
  frame: Buffer;
  /** RX kind this command waits for. */
  expect: ZExpect;
  /** For 'ack' commands, the exact token that confirms success. */
  ackToken?: ZAckToken;
}

// --- TX builders ------------------------------------------------------------

function makeZCommand(
  key: ZCommandKey,
  visible: string,
  expect: ZExpect,
  ackToken?: ZAckToken
): ZBuiltCommand {
  if (!visible.startsWith('#') || !visible.endsWith('#')) {
    throw new Error(`Invalid Z visible command (must be "#...#"): ${JSON.stringify(visible)}`);
  }
  return { key, visible, frame: Buffer.from(visible, 'ascii'), expect, ackToken };
}

export function buildLockZCommand(): ZBuiltCommand {
  return makeZCommand('lockZ', '#LK#', 'ack', 'OK_LK');
}

export function buildUnlockZCommand(): ZBuiltCommand {
  return makeZCommand('unlockZ', '#LS#', 'ack', 'OK_LS');
}

/**
 * Set the Z final speed. `value` is the controller speed register value (NOT
 * mm/s). The width/padding of nnnn is not yet hardware-confirmed — we send the
 * plain decimal value; if the controller needs a fixed width, adjust here once
 * verified (TODO hardware).
 */
export function buildSetZSpeedCommand(value: number): ZBuiltCommand {
  const n = Math.max(0, Math.trunc(value));
  return makeZCommand('setZSpeed', `#VZ${n}#`, 'ack', 'OK_ZFinalSpeed');
}

/**
 * Relative Z move by `pulses` (already sign-resolved via resolveZSign). `sign`
 * is the PHYSICAL '+'/'-' to send. Note the LITERAL space between Z and the
 * number, e.g. "#+Z 15#" (0.001 mm at 15000 pulses/mm).
 */
export function buildMoveZCommand(sign: '+' | '-', pulses: number): ZBuiltCommand {
  const mag = Math.abs(Math.trunc(pulses));
  return makeZCommand('moveZ', `#${sign}Z ${mag}#`, 'status');
}

/**
 * Continuous press-and-hold jog. `sign` is the PHYSICAL direction. There is no
 * immediate reply — motion continues until the stop strategy runs (see the
 * service). Sent fire-and-forget.
 */
export function buildJogZCommand(sign: '+' | '-'): ZBuiltCommand {
  return makeZCommand('jogZ', `#${sign}S#`, 'none');
}

export function buildPollZStatusCommand(): ZBuiltCommand {
  return makeZCommand('pollZStatus', '#sss#', 'status');
}

// --- Direction / unit helpers (pure) ----------------------------------------

/**
 * Map operator intent (UI up/down) to the PHYSICAL command sign, honouring the
 * configured reverseDirection. Base mapping: up → '+', down → '-'. When
 * reverseDirection is true the sign is swapped so the UI arrow matches real
 * motion. The mapping is explicit so the caller can log it — no hidden flips.
 */
export function resolveZSign(direction: ZDirection, reverseDirection: boolean): '+' | '-' {
  const base: '+' | '-' = direction === 'up' ? '+' : '-';
  if (!reverseDirection) return base;
  return base === '+' ? '-' : '+';
}

/** Convert millimetres to pulses using the configured resolution. */
export function zMmToPulses(mm: number, pulsePerMm: number): number {
  return Math.round(mm * pulsePerMm);
}

// Z final-speed REGISTER values per UI tier, sent as the nnnn in "#VZnnnn#".
// TODO(hardware): the exact legacy values are unknown — these are SAFE, clearly
// ordered placeholders (slow < fast < ultra). They are controller register units,
// NOT mm/s, and must be confirmed against the real Z controller before they can
// be trusted. The values are never used to fabricate a reply; the controller's
// OK_ZFinalSpeed ACK is still required.
export const Z_SPEED_REGISTER_VALUES: Record<ZSpeed, number> = {
  slow: 200,
  fast: 1000,
  ultra: 3000,
};

export function zSpeedRegisterValue(speed: ZSpeed): number {
  return Z_SPEED_REGISTER_VALUES[speed];
}

// --- RX parser --------------------------------------------------------------

export type ParsedZReply =
  | { kind: 'ack'; token: ZAckToken; raw: string }
  | { kind: 'status'; token: 'UP' | 'DOWN' | 'STOP' | 'IDLE'; raw: string }
  | { kind: 'error'; raw: string }
  | { kind: 'unknown'; raw: string };

/**
 * Parse ONE already-line-framed Z reply. Trailing CR/LF is trimmed. Matching is
 * case-insensitive on the token but the raw text is preserved for logs. An
 * unrecognised reply is 'unknown' (logged by the caller) — never dropped, never
 * treated as success.
 */
export function parseZReply(raw: string): ParsedZReply {
  const trimmed = raw.replace(/[\r\n]+$/, '').trim();
  const u = trimmed.toUpperCase();
  if (u === 'OK_LK') return { kind: 'ack', token: 'OK_LK', raw: trimmed };
  if (u === 'OK_LS') return { kind: 'ack', token: 'OK_LS', raw: trimmed };
  if (u === 'OK_ZFINALSPEED') return { kind: 'ack', token: 'OK_ZFinalSpeed', raw: trimmed };
  if (u === 'UP') return { kind: 'status', token: 'UP', raw: trimmed };
  if (u === 'DOWN') return { kind: 'status', token: 'DOWN', raw: trimmed };
  if (u === 'STOP') return { kind: 'status', token: 'STOP', raw: trimmed };
  if (u === 'IDLE') return { kind: 'status', token: 'IDLE', raw: trimmed };
  if (/^ERR(OR)?$/.test(u)) return { kind: 'error', raw: trimmed };
  return { kind: 'unknown', raw: trimmed };
}

/** Whether a parsed reply satisfies a command's `expect` (+ ackToken). */
export function replyMatchesExpect(
  parsed: ParsedZReply,
  expect: ZExpect,
  ackToken?: ZAckToken
): boolean {
  if (expect === 'ack') return parsed.kind === 'ack' && (!ackToken || parsed.token === ackToken);
  if (expect === 'status') return parsed.kind === 'status';
  return false;
}
