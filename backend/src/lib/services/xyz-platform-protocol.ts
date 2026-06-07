// XYZ motion-stage RS232 protocol adapter.
//
// This is the SINGLE place XYZ command bytes are built and the SINGLE place RX
// frames are parsed. The X/Y port is operator-selected (e.g. COM6) — never
// hardcoded — and is independent of the hardness-machine/turret port.
//
// HARDWARE-CONFIRMED (2026-06-06, XY port e.g. COM6 @ 9600 8N1, via Hercules against the
// real controller). Earlier raw-mode / "#xxOK" guesses are DISPROVEN below.
//
// TX framing — two modes via setXyzProtocolMode():
//   'checksum' (DEFAULT, CONFIRMED): payload(ascii, no "!") + checksum byte
//              (sum(payload)&0xFF) + 0x21, e.g. "#01!" -> 23 30 31 84 21.
//              `checksum #01!` returned "#01OK" on real hardware.
//   'raw'      (WRONG for this unit): sends "#01!" verbatim. Every raw probe
//              (#02!, #04!, #LS) returned "ERROR". Kept only for diagnose().
//
// RX replies (HARDWARE-CONFIRMED via Hercules):
//   - "#xxOK" — the controller ECHOES the command code, e.g. lock "#01OK",
//     unlock "#02OK", speeds "#05OK".."#0AOK". An optional checksum byte + "!"
//     may follow ("#xxOK<cksum>!"). This IS the ACK. There is NO "OK_LK"/"OK_LS"
//     token reply — that earlier claim was wrong and has been removed.
//   - "ERROR" → HARD failure, surfaced as XYZ_STAGE_PROTOCOL_ERROR. Never an ACK.
//   - "#11:<±8>:<±8><status>!" → position. <status> is '+' idle, '-' busy/motion,
//     or another char (e.g. ',') of unverified meaning; only '-' is treated as
//     busy. An optional checksum byte before '!' is tolerated. Returned by
//     get-position (#10!), moves (#0C/#0E/#11), and stop (#0B).
//
// Protocol table (action | mode | tx | expected ACK | status / safety):
//   XY lock      | checksum | #01! | #01OK                  | CONFIRMED
//   XY unlock    | checksum | #02! | #02OK                  | CONFIRMED
//   get position | checksum | #10! | #11:<±8>:<±8><status>! | CONFIRMED
//   stop X/Y     | checksum | #0B! | #11 position           | CONFIRMED, non-moving
//   set speed    | checksum | #05..#0A | #05OK..#0AOK       | CONFIRMED, non-moving (config)
//   move X/Y     | checksum | #0C/#0E/#11±  | #11 position  | CONFIRMED — RX-gated
//   home         | checksum | #12! | (no immediate reply)   | CONFIRMED — query #10! after a delay
//   Z axis       | (none)   | (none)| (none)                | UNMAPPED — XYZ_Z_COMMAND_NOT_MAPPED, no Z bytes invented
//
// Only X/Y is defined; there is NO confirmed Z protocol.

import { Buffer } from 'node:buffer';

export type XyzDirection =
  | 'left'
  | 'right'
  | 'forward'
  | 'back'
  | 'forward-left'
  | 'forward-right'
  | 'back-left'
  | 'back-right';

export type ZDirection = 'up' | 'down';

export type XySpeed = 'slow' | 'mid' | 'fast';
export type ZSpeed = 'ultra' | 'fast' | 'slow';

export interface XyzPosition {
  x: number;
  y: number;
  z: number;
}

/** Protocol-level command identifiers (one per real X/Y serial frame). */
export type XyzCommandKey =
  | 'lockXy'
  | 'unlockXy'
  | 'getPosition'
  | 'stopXy'
  | 'setXBeginSpeed'
  | 'setXAcceleration'
  | 'setXFinalSpeed'
  | 'setYBeginSpeed'
  | 'setYAcceleration'
  | 'setYFinalSpeed'
  | 'moveX'
  | 'moveY'
  | 'moveXy'
  | 'home';

/** What RX kind a command waits for. Informational/validation aid. */
export type XyzExpect = 'ack' | 'position' | 'ack-or-position';

export interface XyzBuiltCommand {
  /** Protocol command id. */
  key: XyzCommandKey;
  /** Human-visible command including the trailing "!", e.g. "#0C-00000001!". */
  visible: string;
  /** The exact bytes written to the wire (payload + checksum + 0x21). */
  frame: Buffer;
  /** RX kind this command expects. */
  expect: XyzExpect;
  /**
   * Expected ACK code echoed back (e.g. "01" for "#01OK", "05" for
   * "#05OK<cksum>!"). When set, the service resolves the command ONLY on an ACK
   * whose parsed code matches — any other ACK is logged as unmatched (no fake
   * success).
   */
  ackCode?: string;
}

// --- TX builders ------------------------------------------------------------

export type XyzProtocolMode = 'raw' | 'checksum';

// Protocol mode for the whole `#xx!` command family (lock/unlock/moves/speeds/
// position). CONFIRMED 'checksum': the byte before '!' is sum(payload)&0xFF,
// e.g. "#01!" -> 23 30 31 84 21 -> "#01OK". Lock/unlock use this mode like every
// other command. 'raw' is WRONG for this unit and kept only for diagnose().
let activeProtocolMode: XyzProtocolMode = 'checksum';

export function setXyzProtocolMode(mode: XyzProtocolMode): void {
  activeProtocolMode = mode;
}

export function getXyzProtocolMode(): XyzProtocolMode {
  return activeProtocolMode;
}

/** checksum = (sum of payload bytes) & 0xFF. */
export function calculateXyChecksum(payloadBytes: Buffer): number {
  let sum = 0;
  for (const b of payloadBytes) {
    sum = (sum + b) & 0xff;
  }
  return sum & 0xff;
}

/**
 * Turn a visible command (with trailing "!") into the on-wire frame.
 *   raw      → the bytes of the visible command, verbatim ("#01!" as-is).
 *   checksum → payload(ascii, no "!") + checksum byte + 0x21.
 * `mode` defaults to the active protocol mode; diagnose() passes an explicit
 * mode to build both variants regardless of the active one.
 */
export function buildXyVisibleCommandPayload(
  visibleCommand: string,
  mode: XyzProtocolMode = activeProtocolMode
): Buffer {
  if (!visibleCommand.startsWith('#') || !visibleCommand.endsWith('!')) {
    throw new Error(`Invalid XYZ visible command: ${JSON.stringify(visibleCommand)}`);
  }
  if (mode === 'raw') {
    return Buffer.from(visibleCommand, 'ascii');
  }
  const payload = Buffer.from(visibleCommand.slice(0, -1), 'ascii');
  const checksum = calculateXyChecksum(payload);
  return Buffer.concat([payload, Buffer.from([checksum, 0x21])]);
}

function makeCommand(
  key: XyzCommandKey,
  visible: string,
  expect: XyzExpect,
  ackCode?: string
): XyzBuiltCommand {
  return { key, visible, frame: buildXyVisibleCommandPayload(visible), expect, ackCode };
}

/** Signed, 8-digit zero-padded magnitude, e.g. 1 -> "+00000001", -100 -> "-00000100". */
function signed8(value: number): string {
  const n = Math.trunc(value);
  const sign = n < 0 ? '-' : '+';
  const mag = Math.abs(n);
  if (mag > 99_999_999) {
    throw new Error(`XYZ pulse value out of 8-digit range: ${value}`);
  }
  return sign + String(mag).padStart(8, '0');
}

/** Unsigned, 8-digit zero-padded magnitude, e.g. 1 -> "00000001". */
function unsigned8(value: number): string {
  const n = Math.abs(Math.trunc(value));
  if (n > 99_999_999) {
    throw new Error(`XYZ speed value out of 8-digit range: ${value}`);
  }
  return String(n).padStart(8, '0');
}

// HARDWARE-VERIFIED (Hercules): XY lock TX "#01!" (23 30 31 84 21) -> ACK "#01OK";
// XY unlock TX "#02!" (23 30 32 85 21) -> ACK "#02OK". Checksum mode (the byte
// before '!' = sum(payload)&0xFF). The earlier "#LK#"/"OK_LK" path was wrong.
export function buildLockXyCommand(): XyzBuiltCommand {
  return makeCommand('lockXy', '#01!', 'ack', '01');
}

export function buildUnlockXyCommand(): XyzBuiltCommand {
  return makeCommand('unlockXy', '#02!', 'ack', '02');
}

export function buildGetPositionCommand(): XyzBuiltCommand {
  return makeCommand('getPosition', '#10!', 'position');
}

export function buildStopXyCommand(): XyzBuiltCommand {
  // Stop's RX is unspecified; accept either an ACK or a position snapshot.
  return makeCommand('stopXy', '#0B!', 'ack-or-position');
}

export function buildSetXBeginSpeedCommand(value: number): XyzBuiltCommand {
  return makeCommand('setXBeginSpeed', `#05${unsigned8(value)}!`, 'ack', '05');
}

export function buildSetXAccelerationCommand(value: number): XyzBuiltCommand {
  return makeCommand('setXAcceleration', `#06${unsigned8(value)}!`, 'ack', '06');
}

export function buildSetXFinalSpeedCommand(value: number): XyzBuiltCommand {
  return makeCommand('setXFinalSpeed', `#07${unsigned8(value)}!`, 'ack', '07');
}

export function buildSetYBeginSpeedCommand(value: number): XyzBuiltCommand {
  return makeCommand('setYBeginSpeed', `#08${unsigned8(value)}!`, 'ack', '08');
}

export function buildSetYAccelerationCommand(value: number): XyzBuiltCommand {
  return makeCommand('setYAcceleration', `#09${unsigned8(value)}!`, 'ack', '09');
}

export function buildSetYFinalSpeedCommand(value: number): XyzBuiltCommand {
  return makeCommand('setYFinalSpeed', `#0A${unsigned8(value)}!`, 'ack', '0A');
}

export function buildMoveXCommand(pulses: number): XyzBuiltCommand {
  return makeCommand('moveX', `#0C${signed8(pulses)}!`, 'position');
}

export function buildMoveYCommand(pulses: number): XyzBuiltCommand {
  return makeCommand('moveY', `#0E${signed8(pulses)}!`, 'position');
}

export function buildMoveXyCommand(xPulses: number, yPulses: number): XyzBuiltCommand {
  return makeCommand('moveXy', `#11${signed8(xPulses)}${signed8(yPulses)}!`, 'position');
}

export function buildHomeCommand(): XyzBuiltCommand {
  return makeCommand('home', '#12!', 'ack-or-position');
}

// --- RX parser --------------------------------------------------------------
//
// HARDWARE-VERIFIED reply formats (machine -> PC, via Hercules):
//
//   Short ACK : "#xxOK" with an OPTIONAL "<checksum>!" suffix.
//               e.g. "#01OK", "#02OK", "#05OK", or "#05OK<cksum>!".
//   Position  : "#11:<±8>:<±8><status>!" — <status> '+' idle, '-' busy/motion,
//               or another char (e.g. ',') of unverified meaning; only '-' is
//               treated as busy. An optional checksum byte before '!' is
//               tolerated. e.g. "#11:+00040000:+00040000+!",
//               "#11:+00040001:+00040000,!", "#11:+00040002:+00040002-!".
//   Error     : "ERROR".
//
// RX is buffered as latin1 so a checksum byte (if present) survives 1:1.

export type ParsedXyzFrame =
  | {
      kind: 'position';
      x: number;
      y: number;
      busy: boolean;
      /** Raw status char before '!' — '+' idle, '-' busy, or another (e.g. ','). */
      status: string;
      checksum?: number;
      checksumExpected?: number;
      raw: string;
    }
  | { kind: 'ack'; code: string; checksum?: number; checksumExpected?: number; raw: string }
  | { kind: 'error'; error: string; raw: string }
  | { kind: 'unknown'; raw: string };

// "#11:" + ±8 + ":" + ±8 + status(any 1 byte) + OPTIONAL checksum byte + "!".
// status '+' idle, '-' busy, or another char (e.g. ',') — only '-' means busy.
const POSITION_RE = /^#11:([+-]\d{8}):([+-]\d{8})([\s\S])([\s\S]?)!$/;
// "#" + 2-char tag + "OK", with an OPTIONAL checksum byte + "!" (or bare "#xxOK").
const SHORT_ACK_RE = /^#([0-9A-Za-z]{2})OK(?:([\s\S])?!)?$/;
// Generic token ACK "OK" / "OK_<x>" — no checksum byte.
const TOKEN_ACK_RE = /^OK(?:_([A-Za-z0-9]+))?$/i;

/** Sum of every byte BEFORE the trailing "<checksum>!" pair, & 0xFF. */
function expectedFrameChecksum(frame: string): number {
  let sum = 0;
  for (let i = 0; i < frame.length - 2; i += 1) {
    sum = (sum + frame.charCodeAt(i)) & 0xff;
  }
  return sum & 0xff;
}

/**
 * Parse ONE already-framed RX string. Only trailing CR/LF is stripped — an
 * interior checksum byte (when present) is preserved. An unknown frame never
 * yields a position, so a malformed/foreign reply can never move coordinates.
 */
export function parseXyzFrame(rxRaw: string): ParsedXyzFrame {
  const rx = rxRaw.replace(/[\r\n]+$/, '');
  const trimmed = rx.trim();
  if (trimmed.length === 0) {
    return { kind: 'unknown', raw: rxRaw };
  }
  if (/^ERR(OR)?$/i.test(trimmed)) {
    // Hard protocol failure — wrong command/mode for this controller.
    return { kind: 'error', error: 'XYZ_STAGE_PROTOCOL_ERROR', raw: trimmed };
  }

  const posM = rx.match(POSITION_RE);
  if (posM) {
    const withChecksum = posM[4].length === 1; // optional checksum byte matched
    return {
      kind: 'position',
      x: Number.parseInt(posM[1], 10),
      y: Number.parseInt(posM[2], 10),
      busy: posM[3] === '-',
      status: posM[3],
      checksum: withChecksum ? rx.charCodeAt(rx.length - 2) : undefined,
      checksumExpected: withChecksum ? expectedFrameChecksum(rx) : undefined,
      raw: rx,
    };
  }

  const shortAck = rx.match(SHORT_ACK_RE);
  if (shortAck) {
    const withChecksum = rx.endsWith('!') && rx.length === 4 + 2 + 1; // "#xxOK"(5)+cksum+"!"
    return {
      kind: 'ack',
      code: shortAck[1].toUpperCase(),
      checksum: withChecksum ? rx.charCodeAt(rx.length - 2) : undefined,
      checksumExpected: withChecksum ? expectedFrameChecksum(rx) : undefined,
      raw: rx,
    };
  }

  const token = trimmed.match(TOKEN_ACK_RE);
  if (token) {
    return { kind: 'ack', code: token[1] ? token[1].toUpperCase() : 'OK', raw: trimmed };
  }

  return { kind: 'unknown', raw: trimmed };
}
