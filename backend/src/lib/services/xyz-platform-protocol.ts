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

// The four operator XY speed tiers. The six-tier expansion (medium / veryFast /
// superFast / ultraFast) was reverted; those names are accepted ONLY as read-aliases
// for rows persisted during that window and normalized back here so old data still
// loads. ZSpeed is a separate axis enum, intentionally unchanged.
export const XY_SPEED_MODES = ['slow', 'mid', 'fast', 'ultra'] as const;
export type XySpeed = (typeof XY_SPEED_MODES)[number];
export type ZSpeed = 'ultra' | 'fast' | 'slow';

/**
 * Reverse-aliases for values written by the (reverted) six-tier expansion: medium
 * collapses to mid; the high tiers (veryFast/superFast/ultraFast) collapse to ultra.
 */
const XY_SPEED_ALIASES: Record<string, XySpeed> = {
  medium: 'mid',
  veryFast: 'ultra',
  superFast: 'ultra',
  ultraFast: 'ultra',
};

/**
 * Normalize a possibly-legacy speed string to one of the four canonical XY tiers,
 * or null if unrecognized. Canonical values pass through unchanged. Pure.
 */
export function normalizeXySpeed(value: string): XySpeed | null {
  if ((XY_SPEED_MODES as readonly string[]).includes(value)) return value as XySpeed;
  return XY_SPEED_ALIASES[value] ?? null;
}

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

/**
 * Pick the narrowest relative-move frame for a relocation delta, so only the
 * axes that actually change are commanded:
 *   dx≠0 && dy≠0 → #11 (move both)
 *   dx≠0 && dy=0 → #0C (move X only)
 *   dx=0 && dy≠0 → #0E (move Y only)
 *   dx=0 && dy=0 → null (already at target — caller sends nothing)
 */
export function buildRelocationMoveCommand(dx: number, dy: number): XyzBuiltCommand | null {
  if (dx === 0 && dy === 0) return null;
  if (dx !== 0 && dy !== 0) return buildMoveXyCommand(dx, dy);
  if (dx !== 0) return buildMoveXCommand(dx);
  return buildMoveYCommand(dy);
}

export function buildHomeCommand(): XyzBuiltCommand {
  return makeCommand('home', '#12!', 'ack-or-position');
}

// --- Move completion gating (settle-gate) -----------------------------------
//
// A relative move (#0C/#0E/#11) returns position frames; the controller emits an
// in-motion (busy '-') snapshot BEFORE the final idle ('+') frame. Resolving the
// command on that first busy snapshot completes the move early — the long axis has
// barely moved while the short axis is already done, so the stage never reaches
// target (it crept ~6 pulses/relocation). These pure predicates encode the rule
// that move-class completion must wait for the IDLE frame, while every other
// position consumer (get-position #10!, stop #0B) resolves on the first reply.

/**
 * Move-class commands (#0C move X, #0E move Y, #11 move XY) — the relative moves
 * whose completion is settle-gated AND whose settle is driven by a #10! re-query.
 * Stop, get-position, lock/unlock, speed and home are NOT move-class. Home is
 * settle-gated too (see isSettleGatedCommand) but must NOT be #10!-polled — a #10!
 * issued mid-home returns a misleading idle frame at the pre-home position.
 */
export function isMoveClassCommand(key: XyzCommandKey): boolean {
  return key === 'moveX' || key === 'moveY' || key === 'moveXy';
}

/**
 * Commands that complete ONLY on an idle ('+') position frame. The relative moves
 * (#0C/#0E/#11) plus home (#12!): the controller's #12! homing cycle emits a single
 * position frame when it FINISHES, and an in-progress/busy frame must never be
 * accepted as complete. Unlike move-class, home is NOT re-queried with #10! — its
 * idle frame arrives unsolicited from the controller, so the service just waits.
 */
export function isSettleGatedCommand(key: XyzCommandKey): boolean {
  return isMoveClassCommand(key) || key === 'home';
}

/**
 * The controller's TRANSIENT busy reply (e.g. "ERRt!") seen when #10! is queried
 * while the stage is still moving. Distinct from the hard "ERROR" protocol failure:
 * during a move settle it means "still moving — retry", never success and never a
 * hard error. Only recognised in the move-settle context by the caller.
 */
export function isBusyResponseToken(raw: string): boolean {
  return /^ERRt!?$/i.test(raw.trim());
}

/**
 * Whether a parsed position frame should COMPLETE the pending command. Settle-gated
 * commands (relative moves + home) complete ONLY on an idle frame (busy === false);
 * all other position consumers (#10! get-position, #0B stop) complete on the first
 * valid frame.
 */
export function positionFrameCompletesCommand(key: XyzCommandKey, busy: boolean): boolean {
  return isSettleGatedCommand(key) ? !busy : true;
}

/** Whether each physical axis is inverted relative to operator intent. */
export interface AxisInversion {
  reverseX: boolean;
  reverseY: boolean;
}

/**
 * Operator-frame unit vector for each arrow BEFORE axis inversion: +x = right,
 * +y = forward/up. The controller's native pulse sign is derived by applying the
 * configured AxisInversion — so a reversed axis flips the commanded sign without
 * touching the protocol bytes themselves.
 */
const JOG_VECTORS: Record<XyzDirection, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  forward: { x: 0, y: 1 },
  back: { x: 0, y: -1 },
  'forward-left': { x: -1, y: 1 },
  'forward-right': { x: 1, y: 1 },
  'back-left': { x: -1, y: -1 },
  'back-right': { x: 1, y: -1 },
};

/**
 * Build the single relative-move frame for a press-and-hold jog in `direction`,
 * applying `invert` so the UI arrow matches physical operator expectation. Picks
 * the narrowest frame for the axes that actually move:
 *   x≠0 && y≠0 → #11 (both)   x≠0 → #0C (X only)   y≠0 → #0E (Y only)
 * `pulses` is the bounded full-travel magnitude; the matching #0B! (release) is
 * what actually stops the stage.
 */
export function buildJogMoveCommand(
  direction: XyzDirection,
  pulses: number,
  invert: AxisInversion = { reverseX: false, reverseY: false }
): XyzBuiltCommand {
  const v = JOG_VECTORS[direction];
  const x = (invert.reverseX ? -v.x : v.x) * pulses;
  const y = (invert.reverseY ? -v.y : v.y) * pulses;
  if (x !== 0 && y !== 0) return buildMoveXyCommand(x, y);
  if (x !== 0) return buildMoveXCommand(x);
  return buildMoveYCommand(y);
}

/**
 * The operator-frame unit vector (+x = right, +y = up/forward) for an arrow,
 * BEFORE axis inversion — exposed so callers can label or limit a jog by intended
 * axis without re-deriving the mapping or applying the native pulse sign.
 */
export function jogDirectionVector(direction: XyzDirection): { x: number; y: number } {
  return JOG_VECTORS[direction];
}

// Tolerance (mm) for "is the stage AT the soft limit". 0.1 µm — far below the
// pulse resolution (1/pulsePerMm mm), so it only absorbs float rounding, never a
// real step.
const SOFT_LIMIT_EPS_MM = 1e-4;

/** Current operator-frame position and the symmetric ±soft-limit, for clamping. */
export interface XySoftLimitState {
  /** Operator-frame position (physical center = 0, +x = right, +y = up), in mm. */
  displayXmm: number;
  displayYmm: number;
  /** Symmetric per-axis soft limit, in mm (e.g. 25 → ±25 mm). */
  softLimitMm: number;
  /** mm↔pulse factor used to convert the clamped distance into commanded pulses. */
  pulsePerMm: number;
}

/** Result of clamping a jog/step move to the soft limit. */
export interface SoftLimitedMove {
  /** The clamped relative-move frame, or null when EVERY requested axis is blocked. */
  command: XyzBuiltCommand | null;
  commandedXPulses: number;
  commandedYPulses: number;
  /** The requested direction is already AT this edge (zero remaining travel). */
  blockedXMax: boolean;
  blockedXMin: boolean;
  blockedYMax: boolean;
  blockedYMin: boolean;
}

/**
 * Build a relative-move frame for `direction` whose per-axis magnitude is CLAMPED
 * to the remaining distance to the symmetric ±softLimitMm soft limit (operator
 * frame), so the stage can never be commanded past the limit. An axis already at
 * its limit contributes zero pulses and is flagged blocked; when both requested
 * axes are blocked the command is null (caller sends nothing — no motion). For a
 * diagonal with one axis blocked, the free axis still moves (the spec's "only Y
 * may continue"). `maxMagnitudeMm` is the unclamped distance (jog: full travel;
 * tap: the per-tier step). Axis inversion flips only the commanded pulse SIGN,
 * exactly like buildJogMoveCommand.
 */
export function buildSoftLimitedMoveCommand(
  direction: XyzDirection,
  maxMagnitudeMm: number,
  invert: AxisInversion,
  limit: XySoftLimitState
): SoftLimitedMove {
  const v = JOG_VECTORS[direction];
  const { displayXmm, displayYmm, softLimitMm, pulsePerMm } = limit;

  // Remaining travel (mm) toward the requested edge, clamped to [0, maxMagnitudeMm].
  const axis = (dir: number, pos: number) => {
    if (dir > 0) {
      const remaining = softLimitMm - pos;
      return { allowed: Math.max(0, Math.min(maxMagnitudeMm, remaining)), atMax: remaining <= SOFT_LIMIT_EPS_MM, atMin: false };
    }
    if (dir < 0) {
      const remaining = pos + softLimitMm;
      return { allowed: Math.max(0, Math.min(maxMagnitudeMm, remaining)), atMax: false, atMin: remaining <= SOFT_LIMIT_EPS_MM };
    }
    return { allowed: 0, atMax: false, atMin: false };
  };

  const ax = axis(v.x, displayXmm);
  const ay = axis(v.y, displayYmm);

  const xSign = (v.x > 0 ? 1 : v.x < 0 ? -1 : 0) * (invert.reverseX ? -1 : 1);
  const ySign = (v.y > 0 ? 1 : v.y < 0 ? -1 : 0) * (invert.reverseY ? -1 : 1);
  const commandedXPulses = xSign * Math.round(ax.allowed * pulsePerMm);
  const commandedYPulses = ySign * Math.round(ay.allowed * pulsePerMm);

  let command: XyzBuiltCommand | null = null;
  if (commandedXPulses !== 0 && commandedYPulses !== 0) command = buildMoveXyCommand(commandedXPulses, commandedYPulses);
  else if (commandedXPulses !== 0) command = buildMoveXCommand(commandedXPulses);
  else if (commandedYPulses !== 0) command = buildMoveYCommand(commandedYPulses);

  return {
    command,
    commandedXPulses,
    commandedYPulses,
    blockedXMax: ax.atMax,
    blockedXMin: ax.atMin,
    blockedYMax: ay.atMax,
    blockedYMin: ay.atMin,
  };
}

/**
 * Convert a native (controller-pulse) X/Y position into the OPERATOR display
 * frame: physical-center-relative mm where +x = right and +y = up/forward. Axis
 * inversion flips the sign so the displayed coordinate increases in the same
 * direction the positive arrow drives the stage. This is the coordinate the
 * ±soft-limit applies to and the value the Position panel shows — distinct from
 * absolute machine mm (used by pattern/overlay).
 */
export function nativeToDisplayMm(
  nativeXPulses: number,
  nativeYPulses: number,
  centerXPulses: number,
  centerYPulses: number,
  pulsePerMm: number,
  invert: AxisInversion
): { x: number; y: number } {
  const ppm = pulsePerMm > 0 ? pulsePerMm : 1;
  return {
    x: (invert.reverseX ? centerXPulses - nativeXPulses : nativeXPulses - centerXPulses) / ppm,
    y: (invert.reverseY ? centerYPulses - nativeYPulses : nativeYPulses - centerYPulses) / ppm,
  };
}

/** Which symmetric ±softLimitMm edges an operator-frame position has reached. */
export function xyAtSoftLimit(
  displayXmm: number,
  displayYmm: number,
  softLimitMm: number
): { xMin: boolean; xMax: boolean; yMin: boolean; yMax: boolean } {
  return {
    xMax: displayXmm >= softLimitMm - SOFT_LIMIT_EPS_MM,
    xMin: displayXmm <= -softLimitMm + SOFT_LIMIT_EPS_MM,
    yMax: displayYmm >= softLimitMm - SOFT_LIMIT_EPS_MM,
    yMin: displayYmm <= -softLimitMm + SOFT_LIMIT_EPS_MM,
  };
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
