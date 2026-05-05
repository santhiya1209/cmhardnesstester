// Hardness machine RS232 protocol adapter.
//
// This module is a *framework* for the wire protocol. The actual command bytes
// for each control (force/lightness/objective/loadTime/hardnessLevel/indent)
// are NOT defined here — populate `COMMAND_MAP` from the official protocol
// manual. Until the manual is provided, command builders return `null` and the
// service refuses to transmit. This is intentional: sending guessed frames to
// the indent motor or load cell could damage the machine.
//
// What IS implemented (and ready to use the moment the manual lands):
//   - Configurable frame format (`PROTOCOL_CONFIG`): start byte, end byte,
//     checksum algorithm (none/XOR/CRC8), encoding (ascii/binary).
//   - Generic `buildFrame()` that wraps a command + value into the configured
//     framing with checksum.
//   - Streaming parser `parseMachineMessage()` that extracts ONE complete
//     frame from a rolling buffer and returns the remainder for the next call,
//     so the service can call it in a loop until it returns `unknown`.
//   - Frame-kind discrimination (state-update/ack/nak/indent-status).
//
// To bring the machine online, fill in:
//   1. PROTOCOL_CONFIG.startByte / endByte / checksum / encoding
//   2. COMMAND_MAP entries (the `code` and `formatValue` per control)
//   3. RESPONSE_PARSER body (decode kind + fields from the frame payload)
//
// Do NOT add speculative bytes to ship the feature. A loud TODO is correct.

import { Buffer } from 'node:buffer';

export type MachineControlKey =
  | 'force'
  | 'lightness'
  | 'loadTime'
  | 'objective'
  | 'hardnessLevel';

export type MachineCommandKey = MachineControlKey | 'indent';
export type MachineCommandVerification = Record<MachineCommandKey, boolean>;

export type ParsedMachineFrame =
  | {
      kind: 'state-update';
      key: MachineControlKey;
      value: string | number;
    }
  | { kind: 'indent-status'; status: 'started' | 'running' | 'completed' | 'error'; message?: string }
  | { kind: 'ack' }
  | { kind: 'nak'; message?: string }
  | { kind: 'unknown'; raw: Buffer };

export type FrameOrNull = Buffer | null;

// ---------------------------------------------------------------------------
// Protocol configuration — populate from the machine manual.
// ---------------------------------------------------------------------------

export type ChecksumMode = 'none' | 'xor' | 'crc8';
export type FrameEncoding = 'ascii' | 'binary';

export interface ProtocolConfig {
  /** Frame start byte (e.g. 0x02 STX). null = no start byte. */
  startByte: number | null;
  /** Frame end byte (e.g. 0x03 ETX, or 0x0D CR, or 0x0A LF). null = no end byte. */
  endByte: number | null;
  /** Checksum algorithm applied to the payload (between start and end bytes). */
  checksum: ChecksumMode;
  /** Whether the command code + value are encoded as ASCII text or raw bytes. */
  encoding: FrameEncoding;
}

// Temporary parser framing only. Command TX remains disabled until the official
// machine manual confirms these framing bytes and the per-command codes below.
//
// Serial line settings (set by the caller in connectMachine, defaults match):
//   COM7, 9600 baud, 8 data bits, no parity, 1 stop bit.
export const PROTOCOL_CONFIG: ProtocolConfig = {
  startByte: 0x02, // STX
  endByte: 0x03,   // ETX
  checksum: 'xor',
  encoding: 'ascii',
};

// ---------------------------------------------------------------------------
// Command map — populate from the machine manual.
// ---------------------------------------------------------------------------

interface CommandMapEntry {
  /** Command code as it appears on the wire (ASCII text or hex bytes). */
  code: string;
  /** Convert the high-level value (e.g. "0.5kgf", "10X", 5) into wire form. */
  formatValue(value: string | number): string;
  /**
   * Set to TRUE only after the `code` has been verified against the official
   * machine manual. While `false`, buildFromMap() refuses to transmit — this
   * is the safety net that prevents speculative bytes from reaching the
   * indent motor or load cell.
   */
  verified: boolean;
}

// Placeholder command map. EVERY entry is marked `verified: false` until the
// real RS232 manual confirms the wire codes. While unverified, buildFromMap()
// returns null and the service does NOT transmit. Once you have the manual:
//   1. Replace each `code: '__TODO__'` with the real command string/byte.
//   2. Adjust `formatValue` if the wire form differs from what the manual
//      specifies (e.g. force as "050" vs "0.5", objective as "10" vs "10X").
//   3. Flip `verified: true` for that entry.
//
// Helpers for value formatting are intentionally conservative — they strip
// the human-facing unit suffix where common, but the actual wire format MUST
// be confirmed from the manual.
const COMMAND_KEYS: MachineCommandKey[] = [
  'force',
  'lightness',
  'loadTime',
  'objective',
  'hardnessLevel',
  'indent',
];

const COMMAND_MAP: Partial<Record<MachineCommandKey, CommandMapEntry>> = {
  // TODO(protocol): real code from manual, then `verified: true`.
  force: {
    code: '__TODO__',
    formatValue: (v) => String(v).replace(/kgf$/i, '').trim(),
    verified: false,
  },
  // TODO(protocol)
  lightness: {
    code: '__TODO__',
    formatValue: (v) => String(Number(v) || 0),
    verified: false,
  },
  // TODO(protocol)
  loadTime: {
    code: '__TODO__',
    formatValue: (v) => String(Number(v) || 0),
    verified: false,
  },
  // TODO(protocol)
  objective: {
    code: '__TODO__',
    formatValue: (v) => String(v).toUpperCase().trim(),
    verified: false,
  },
  // TODO(protocol)
  hardnessLevel: {
    code: '__TODO__',
    formatValue: (v) => String(v).trim(),
    verified: false,
  },
  // TODO(protocol): indent triggers physical motion. NEVER flip verified=true
  // until the indent command bytes have been confirmed from the manual AND
  // tested with the load cell on a sacrificial sample.
  indent: {
    code: '__TODO__',
    formatValue: () => '',
    verified: false,
  },
};

// ---------------------------------------------------------------------------
// Checksum utilities.
// ---------------------------------------------------------------------------

export function xorChecksum(payload: Buffer): number {
  let acc = 0;
  for (const b of payload) acc ^= b;
  return acc & 0xff;
}

export function crc8(payload: Buffer, polynomial = 0x07, init = 0x00): number {
  let crc = init;
  for (const b of payload) {
    crc ^= b;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ polynomial) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

function computeChecksum(payload: Buffer, mode: ChecksumMode): Buffer {
  switch (mode) {
    case 'none':
      return Buffer.alloc(0);
    case 'xor':
      return Buffer.from([xorChecksum(payload)]);
    case 'crc8':
      return Buffer.from([crc8(payload)]);
  }
}

export function verifyChecksum(payload: Buffer, expected: number, mode: ChecksumMode): boolean {
  switch (mode) {
    case 'none':
      return true;
    case 'xor':
      return xorChecksum(payload) === expected;
    case 'crc8':
      return crc8(payload) === expected;
  }
}

// ---------------------------------------------------------------------------
// Frame builder.
// ---------------------------------------------------------------------------

interface BuildFrameInput {
  command: string;
  value?: string;
}

/**
 * Wraps `<command><value>` in the configured framing + checksum. Returns null
 * if the protocol is not yet configured (i.e. nothing in COMMAND_MAP can call
 * this).
 */
export function buildFrame(input: BuildFrameInput, config: ProtocolConfig = PROTOCOL_CONFIG): Buffer {
  const text = input.command + (input.value ?? '');
  const payload =
    config.encoding === 'ascii'
      ? Buffer.from(text, 'ascii')
      : Buffer.from(text, 'binary');
  const checksum = computeChecksum(payload, config.checksum);
  const parts: Buffer[] = [];
  if (config.startByte !== null) parts.push(Buffer.from([config.startByte]));
  parts.push(payload);
  parts.push(checksum);
  if (config.endByte !== null) parts.push(Buffer.from([config.endByte]));
  return Buffer.concat(parts);
}

function logBuild(name: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log('[machine-protocol] build command', name, value);
}

export function isCommandVerified(key: MachineCommandKey): boolean {
  const entry = COMMAND_MAP[key];
  return Boolean(entry?.verified && entry.code !== '__TODO__');
}

export function getCommandVerification(): MachineCommandVerification {
  const verification = {} as MachineCommandVerification;
  for (const key of COMMAND_KEYS) {
    verification[key] = isCommandVerified(key);
  }
  return verification;
}

function buildFromMap(key: MachineCommandKey, value: string | number | null): FrameOrNull {
  const entry = COMMAND_MAP[key];
  if (!entry) {
    // eslint-disable-next-line no-console
    console.warn(
      `[machine-protocol] no command map entry for "${key}" — refusing to transmit (TODO: populate COMMAND_MAP from machine manual)`
    );
    return null;
  }
  if (!entry.verified || entry.code === '__TODO__') {
    // Safety gate: never transmit speculative bytes to the machine. Flip
    // `verified: true` in COMMAND_MAP once the code is confirmed.
    // eslint-disable-next-line no-console
    console.warn(
      `[machine-protocol] command "${key}" is not verified yet — refusing to transmit (TODO: confirm code from manual then flip verified=true)`
    );
    return null;
  }
  const formatted = value === null ? '' : entry.formatValue(value);
  return buildFrame({ command: entry.code, value: formatted });
}

export function buildSetForceCommand(value: string | number): FrameOrNull {
  logBuild('setForce', value);
  return buildFromMap('force', value);
}

export function buildSetLightnessCommand(value: string | number): FrameOrNull {
  logBuild('setLightness', value);
  return buildFromMap('lightness', value);
}

export function buildSetLoadTimeCommand(value: string | number): FrameOrNull {
  logBuild('setLoadTime', value);
  return buildFromMap('loadTime', value);
}

export function buildSetObjectiveCommand(value: string | number): FrameOrNull {
  logBuild('setObjective', value);
  return buildFromMap('objective', value);
}

export function buildSetHardnessLevelCommand(value: string | number): FrameOrNull {
  logBuild('setHardnessLevel', value);
  return buildFromMap('hardnessLevel', value);
}

export function buildStartIndentCommand(): FrameOrNull {
  logBuild('startIndent', null);
  // Indent triggers physical motion. If the map entry is missing, refuse hard.
  return buildFromMap('indent', null);
}

export function buildCommandForKey(key: MachineControlKey, value: string | number): FrameOrNull {
  switch (key) {
    case 'force':
      return buildSetForceCommand(value);
    case 'lightness':
      return buildSetLightnessCommand(value);
    case 'loadTime':
      return buildSetLoadTimeCommand(value);
    case 'objective':
      return buildSetObjectiveCommand(value);
    case 'hardnessLevel':
      return buildSetHardnessLevelCommand(value);
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Streaming parser.
// ---------------------------------------------------------------------------

export interface ParseResult {
  /** The decoded frame (or 'unknown' if no complete frame is available yet). */
  frame: ParsedMachineFrame;
  /** Bytes consumed from the front of the input buffer. */
  consumed: number;
}

function isLikelyAsciiLineChunk(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte === 0x0d || byte === 0x0a || byte === 0x09) continue;
    if (byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

function parseAsciiLine(line: Buffer): ParsedMachineFrame {
  const payload = line.toString('ascii').replace(/\r$/, '');
  return classifyFrame(Buffer.from(payload, 'ascii'), payload);
}

/**
 * Try to extract ONE complete frame from the front of `buffer`. Returns the
 * decoded frame plus the number of bytes consumed. The caller is responsible
 * for slicing `buffer` and calling again to drain multiple frames per chunk.
 */
export function tryParseOneFrame(buffer: Buffer, config: ProtocolConfig = PROTOCOL_CONFIG): ParseResult {
  if (buffer.length === 0) {
    return { frame: { kind: 'unknown', raw: buffer }, consumed: 0 };
  }

  let start = 0;
  if (config.startByte !== null) {
    const idx = buffer.indexOf(config.startByte);
    if (idx < 0) {
      // The observed machine traffic is ASCII line-oriented (`...\n`) and can
      // arrive split across serial chunks. Log full newline-terminated frames
      // for reverse engineering, but do not map values until the manual or
      // controlled captures verify the meaning of each code.
      const lineEnd = buffer.indexOf(0x0a);
      if (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd);
        return { frame: parseAsciiLine(line), consumed: lineEnd + 1 };
      }
      if (isLikelyAsciiLineChunk(buffer) && buffer.length < 256) {
        return { frame: { kind: 'unknown', raw: buffer.slice(0, 0) }, consumed: 0 };
      }
      // No recognizable framing — drop everything; protect against infinite buffering.
      return { frame: { kind: 'unknown', raw: buffer }, consumed: buffer.length };
    }
    start = idx + 1;
  }

  let end: number;
  if (config.endByte !== null) {
    end = buffer.indexOf(config.endByte, start);
    if (end < 0) {
      // Wait for more data.
      return { frame: { kind: 'unknown', raw: buffer.slice(0, 0) }, consumed: 0 };
    }
  } else {
    // No end delimiter — caller must give us a complete frame.
    end = buffer.length;
  }

  const checksumLen = config.checksum === 'none' ? 0 : 1;
  const payloadEnd = end - checksumLen;
  if (payloadEnd < start) {
    return { frame: { kind: 'unknown', raw: buffer.slice(0, end + 1) }, consumed: end + 1 };
  }
  const payload = buffer.slice(start, payloadEnd);
  if (checksumLen > 0) {
    const expected = buffer[payloadEnd];
    if (!verifyChecksum(payload, expected, config.checksum)) {
      // eslint-disable-next-line no-console
      console.warn('[machine-protocol] checksum failed for frame', payload.toString('hex'));
      return { frame: { kind: 'nak', message: 'checksum failed' }, consumed: end + 1 };
    }
  }

  const consumed = config.endByte !== null ? end + 1 : end;
  const text = config.encoding === 'ascii' ? payload.toString('ascii') : payload.toString('binary');
  return { frame: classifyFrame(payload, text), consumed };
}

/**
 * Map the decoded payload to a high-level frame kind. Until the protocol is
 * confirmed this returns `unknown` for everything that doesn't look obviously
 * like an ACK/NAK byte. Replace the body with the real decoding rules.
 */
function classifyFrame(payload: Buffer, text: string): ParsedMachineFrame {
  if (payload.length === 0) return { kind: 'unknown', raw: payload };
  // eslint-disable-next-line no-console
  console.log(`[machine-protocol] rx text=${JSON.stringify(text)} hex=${payload.toString('hex')}`);

  // Common terse responses many machines use. Safe to recognize because they
  // are universal and don't trigger any motion.
  if (text === 'ACK' || payload[0] === 0x06 /* ACK */) return { kind: 'ack' };
  if (text === 'NAK' || payload[0] === 0x15 /* NAK */) return { kind: 'nak' };

  const objectiveMatch = /^L([12])OK$/.exec(text);
  if (objectiveMatch) {
    // Observed receive-only objective mapping from controlled machine-panel
    // tests: physical 10X emits `L1OK\n`; physical 40X emits `L2OK\n`.
    // `L3OK` is intentionally left unknown because it appears in other flows.
    return {
      kind: 'state-update',
      key: 'objective',
      value: objectiveMatch[1] === '1' ? '10X' : '40X',
    };
  }

  const forceMap: Record<string, string> = {
    C00: '0.01kgf',
    C03: '0.025kgf',
    C04: '0.05kgf',
    C05: '0.1kgf',
    C06: '0.2kgf',
    C07: '0.3kgf',
    C08: '0.5kgf',
    C09: '1kgf',
  };
  if (text in forceMap) {
    // Observed receive-only force mapping from controlled physical-panel tests.
    return { kind: 'state-update', key: 'force', value: forceMap[text] };
  }

  const loadTimeMatch = /^T(\d{2})$/.exec(text);
  if (loadTimeMatch) {
    // Observed receive-only load-time mapping: physical values 5/10/15 seconds
    // emit `T05\n`, `T10\n`, `T15\n`.
    const loadTime = Number(loadTimeMatch[1]);
    if (loadTime >= 1 && loadTime <= 99) {
      return { kind: 'state-update', key: 'loadTime', value: loadTime };
    }
    return { kind: 'unknown', raw: payload };
  }

  const lightnessMatch = /^K(\d{4})$/.exec(text);
  if (lightnessMatch) {
    // Observed receive-only mapping from the connected tester: when the
    // physical display Lightness is 2, the machine emits `K0002\n`.
    // This parser only updates PC state from real RX bytes; it does not enable
    // any PC-to-machine write command.
    const lightness = Number(lightnessMatch[1]);
    if (lightness >= 0 && lightness <= 9) {
      return { kind: 'state-update', key: 'lightness', value: lightness };
    }
    return { kind: 'unknown', raw: payload };
  }

  // TODO(protocol): decode state-update + indent-status from `text`/`payload`
  // once the manual is in hand. Until then, surface as 'unknown' so the
  // service logs but does not mutate state from a guess.
  return { kind: 'unknown', raw: payload };
}

/**
 * Back-compat: parse a single buffer, returning just the frame. Prefer
 * `tryParseOneFrame` for streaming.
 */
export function parseMachineMessage(buffer: Buffer): ParsedMachineFrame {
  const { frame } = tryParseOneFrame(buffer);
  // eslint-disable-next-line no-console
  console.log('[machine-protocol] parse result kind=', frame.kind, 'len=', buffer.length);
  return frame;
}
