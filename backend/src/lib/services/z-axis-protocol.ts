// Z-axis motion-stage RS232 protocol adapter.
//
// This is the SINGLE place Z command bytes are built and the SINGLE place Z RX
// replies are parsed. The Z port is operator-selected (Serial Port Setting →
// zPortName) — never hardcoded — and is a SEPARATE physical connection from the
// X/Y stage port and the hardness-machine/turret port.
//
// SOURCE: the old (working) software's Z-axis command set. This is a DIFFERENT
// controller and a DIFFERENT framing from the X/Y stage (which uses the checksum
// "#xx!" → "#xxOK" protocol in xyz-platform-protocol.ts). NOTHING here is shared
// with the X/Y protocol — in particular there is NO checksum on the Z link.
//
// TX framing (PC → PLC):  "#" + payload + "#"      (plain ASCII, NO checksum)
// RX framing (PLC → PC):  payload + "\n"           (LF-terminated, NO checksum)
//
// Protocol table (action | tx | reply must CONTAIN):
//   lock / enable Z   | #LK#        | OK_LK
//   loosen / release  | #LS#        | OK_LS
//   stop motion       | #SSS#       | UP
//   continuous jog up | #+S#        | SOK
//   continuous jog dn | #-S#        | SOK
//   step move up      | #+Z <n>#    | >Z:        (LITERAL space between Z and n)
//   step move down    | #-Z <n>#    | >Z:        (LITERAL space between Z and n)
//   set final speed   | #VZ <r>#    | OK_ZFinalSpeed (LITERAL space between VZ and r)
//
// Replies are matched by SUBSTRING (the controller may append extra text, e.g.
// ">Z:12345"). Matching is case-sensitive against the verified tokens above. An
// RX line that contains none of the expected tokens is never treated as success.

import { Buffer } from 'node:buffer';
import type { ZDirection, ZSpeed } from './xyz-platform-protocol';

export type ZCommandKey =
  | 'lockZ'
  | 'loosenZ'
  | 'stopZ'
  | 'jogZ'
  | 'moveZ'
  | 'setZSpeed'
  | 'pollZStatus'
  | 'probeZ';

/** The verified RX substrings a command waits for. `any` = the probe (accept any line). */
export type ZExpectToken = 'OK_LK' | 'OK_LS' | 'SOK' | 'UP' | '>Z:' | 'OK_ZFinalSpeed';
export type ZExpect = ZExpectToken | 'any';

export interface ZBuiltCommand {
  key: ZCommandKey;
  /** Human-visible command including both '#' delimiters, e.g. "#+Z 15#". */
  visible: string;
  /** Exact bytes written to the wire (the visible string as ASCII). */
  frame: Buffer;
  /** RX substring this command waits for ('any' for the probe). */
  expect: ZExpect;
}

// --- TX framing -------------------------------------------------------------

/** Wrap a payload as a Z frame: "#" + payload + "#". Pure, no checksum. */
export function buildZFrame(payload: string): string {
  return `#${payload}#`;
}

function makeZCommand(key: ZCommandKey, payload: string, expect: ZExpect): ZBuiltCommand {
  const visible = buildZFrame(payload);
  return { key, visible, frame: Buffer.from(visible, 'ascii'), expect };
}

const magnitude = (pulses: number): number => Math.abs(Math.trunc(pulses));
const register = (rate: number): number => Math.max(0, Math.trunc(rate));

// --- Pure command builders (the spec's public API) --------------------------

export function buildZLockCommand(): ZBuiltCommand {
  return makeZCommand('lockZ', 'LK', 'OK_LK');
}

export function buildZLoosenCommand(): ZBuiltCommand {
  return makeZCommand('loosenZ', 'LS', 'OK_LS');
}

/**
 * Stop motion. The payload is configurable (Serial settings → zStopPayload,
 * default 'SSS') because the verified stop token is still being confirmed on
 * hardware; the expected reply remains 'UP'. A PLC 'ERROR' is handled by the
 * service as a definitive response, not a timeout.
 */
export function buildZStopCommand(payload: string = 'SSS'): ZBuiltCommand {
  return makeZCommand('stopZ', payload, 'UP');
}

export function buildZJogUpCommand(): ZBuiltCommand {
  return makeZCommand('jogZ', '+S', 'SOK');
}

export function buildZJogDownCommand(): ZBuiltCommand {
  return makeZCommand('jogZ', '-S', 'SOK');
}

/** Step move up by `pulses` (magnitude only). Note the LITERAL space: "#+Z 15#". */
export function buildZMoveUpCommand(pulses: number): ZBuiltCommand {
  return makeZCommand('moveZ', `+Z ${magnitude(pulses)}`, '>Z:');
}

/** Step move down by `pulses` (magnitude only). Note the LITERAL space: "#-Z 15#". */
export function buildZMoveDownCommand(pulses: number): ZBuiltCommand {
  return makeZCommand('moveZ', `-Z ${magnitude(pulses)}`, '>Z:');
}

/** Set the Z final speed. `rate` is the controller speed register value (NOT mm/s). */
export function buildZSetSpeedCommand(rate: number): ZBuiltCommand {
  return makeZCommand('setZSpeed', `VZ ${register(rate)}`, 'OK_ZFinalSpeed');
}

/** Build the Z move command for a pre-resolved physical sign. */
export function buildZMoveCommand(sign: '+' | '-', pulses: number): ZBuiltCommand {
  return sign === '+' ? buildZMoveUpCommand(pulses) : buildZMoveDownCommand(pulses);
}

/** Build the Z jog command for a pre-resolved physical sign. */
export function buildZJogCommand(sign: '+' | '-'): ZBuiltCommand {
  return sign === '+' ? buildZJogUpCommand() : buildZJogDownCommand();
}

/** Legacy status poll (#sss#). Diagnostic only — NOT one of the verified motion commands. */
export function buildPollZStatusCommand(): ZBuiltCommand {
  return makeZCommand('pollZStatus', 'sss', 'any');
}

/** Wrap an arbitrary operator-supplied payload for the manual Z probe (accepts any reply). */
export function buildZProbeCommand(payload: string): ZBuiltCommand {
  return makeZCommand('probeZ', payload, 'any');
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

// Z final-speed REGISTER values per UI tier, sent as <r> in "#VZ <r>#". These are
// controller register units, NOT mm/s. The controller's OK_ZFinalSpeed ACK is
// always required — these values are never used to fabricate a reply.
export const Z_SPEED_REGISTER_VALUES: Record<ZSpeed, number> = {
  slow: 200,
  fast: 1000,
  ultra: 3000,
};

export function zSpeedRegisterValue(speed: ZSpeed): number {
  return Z_SPEED_REGISTER_VALUES[speed];
}

// --- RX parser (LF-framed, substring match, NO checksum) --------------------

/**
 * Split an accumulated RX buffer into complete lines on LF (0x0A) ONLY. Any
 * trailing partial line (no LF yet) is returned as `rest` to be buffered until
 * the next chunk. A stray CR before the LF is tolerated by {@link normalizeZLine}.
 */
export function splitZLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}

/** Trim a trailing CR (CRLF tolerance) and surrounding whitespace from one RX line. */
export function normalizeZLine(raw: string): string {
  return raw.replace(/\r$/, '').trim();
}

/** Does an RX line satisfy a command's expectation? Substring match; `any` accepts all. */
export function replyMatchesExpect(line: string, expect: ZExpect): boolean {
  if (expect === 'any') return true;
  return line.includes(expect);
}

export type ZLineKind = 'ack' | 'status' | 'error' | 'unknown';

/** Classify an RX line for diagnostics/logging (not used to gate command success). */
export function classifyZLine(line: string): ZLineKind {
  if (line.includes('OK_LK') || line.includes('OK_LS') || line.includes('OK_ZFinalSpeed')) {
    return 'ack';
  }
  if (line.includes('SOK') || line.includes('UP') || line.includes('>Z:')) return 'status';
  if (/\bERR(OR)?\b/i.test(line)) return 'error';
  return 'unknown';
}
