// Hardness machine RS232 protocol adapter.
//
// Command bytes here were extracted from the managed .NET
// Communication.dll used by the original tester software:
// Labtt.Communication.MasterControl.CodeTranslator.
//
// Confirmed TX/RX shape:
//   force / load -> TX "#<scale><value:D8>!"  (DLL pattern '#0{scale}{0:D8}!').
//                   Examples: 0.5kgf -> "#0800000500!", 1kgf -> "#0900001000!".
//                   No \r terminator. Machine echoes either the same '#..!' frame,
//                   or an AV-state batch, or a bare OK — all accepted as ACK.
//                   The earlier "UC08\r"/"C08" pair was inferred but proved silent
//                   on the real machine; do not reintroduce it.
//   objective 40X -> TX "UL2\r",  machine RX echo/status "L2OK"
//   lightness 5   -> TX "UK0005\r", machine RX echo/status "K0005"
//   load time 5   -> TX "UT05\r", machine RX echo/status "T05"
//   indent        -> TX "UV{scale}{force*1000:D7}{loadTime:D6}{P|X}\r",
//                    machine completion "FINISH"
//   turret slot n -> TX "ULn\r",  machine RX echo/status "LnOK"
//
// Do not add speculative bytes. Keep commands verified=false until either the
// DLL, protocol manual, or a direction-labelled serial capture confirms them.

import { Buffer } from 'node:buffer';

export type MachineControlKey =
  | 'force'
  | 'lightness'
  | 'loadTime'
  | 'objective'
  | 'hardnessLevel';

export type TurretDirection = 'left' | 'front' | 'right';

export type MachineCommandKey =
  | MachineControlKey
  | 'indent'
  | 'turretLeft'
  | 'turretFront'
  | 'turretRight';
export type MachineCommandVerification = Record<MachineCommandKey, boolean>;

export type ParsedMachineFrame =
  | {
      kind: 'state-update';
      key: MachineControlKey;
      value: string | number;
    }
  | {
      kind: 'state-batch';
      values: Partial<Record<MachineControlKey, string | number>>;
      turretSlot?: string;
      turretDirection?: TurretDirection;
    }
  | {
      kind: 'turret-update';
      slot: string;
      direction?: TurretDirection;
      objective?: string;
    }
  | { kind: 'indent-status'; status: 'started' | 'running' | 'completed' | 'error'; message?: string }
  | { kind: 'ack' }
  | { kind: 'nak'; message?: string }
  | { kind: 'unknown'; raw: Buffer };

export type FrameOrNull = Buffer | null;

export type ChecksumMode = 'none' | 'xor' | 'crc8';
export type FrameEncoding = 'ascii' | 'binary';

export interface ProtocolConfig {
  /** Frame start byte. null = no start byte. */
  startByte: number | null;
  /** Frame end byte. null = no end byte. */
  endByte: number | null;
  /** Checksum algorithm applied to the payload. */
  checksum: ChecksumMode;
  /** Whether the command code + value are encoded as ASCII text or raw bytes. */
  encoding: FrameEncoding;
}

// Serial line settings are selected by connectMachine:
//   COM7, 9600 baud, 8 data bits, no parity, 1 stop bit.
export const PROTOCOL_CONFIG: ProtocolConfig = {
  startByte: null,
  endByte: 0x0d,
  checksum: 'none',
  encoding: 'ascii',
};

interface CommandMapEntry {
  /** Command prefix as it appears on the wire. */
  code: string;
  /** Convert the high-level value into wire form. null means not verified. */
  formatValue(value: string | number): string | null;
  /** False means buildFromMap() refuses to transmit. */
  verified: boolean;
}

const COMMAND_KEYS: MachineCommandKey[] = [
  'force',
  'lightness',
  'loadTime',
  'objective',
  'hardnessLevel',
  'indent',
  'turretLeft',
  'turretFront',
  'turretRight',
];

const TURRET_COMMAND_KEY: Record<TurretDirection, MachineCommandKey> = {
  left: 'turretLeft',
  front: 'turretFront',
  right: 'turretRight',
};

const TURRET_SLOT_BY_DIRECTION: Record<TurretDirection, string> = {
  left: '1',
  front: '2',
  right: '3',
};

const TURRET_DIRECTION_BY_SLOT: Record<string, TurretDirection> = Object.fromEntries(
  Object.entries(TURRET_SLOT_BY_DIRECTION).map(([direction, slot]) => [slot, direction])
) as Record<string, TurretDirection>;

const FORCE_SCALE_CODE_BY_VALUE: Record<string, string> = {
  '0.01kgf': '00',
  '0.025kgf': '03',
  '0.05kgf': '04',
  '0.1kgf': '05',
  '0.2kgf': '06',
  '0.3kgf': '07',
  '0.5kgf': '08',
  '1kgf': '09',
};

const FORCE_REAL_CODE_BY_VALUE: Record<string, string> = {
  '0.01kgf': '0000010',
  '0.025kgf': '0000025',
  '0.05kgf': '0000050',
  '0.1kgf': '0000100',
  '0.2kgf': '0000200',
  '0.3kgf': '0000300',
  '0.5kgf': '0000500',
  '1kgf': '0001000',
};

const FORCE_VALUE_BY_SCALE_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(FORCE_SCALE_CODE_BY_VALUE).map(([value, code]) => [code, value])
);

// Current connected tester mapping confirmed from live RX captures:
//   L1OK -> 10X, L2OK -> 40X. The DLL confirms UL<n>\r as the turret TX
// shape, but objective-per-turret is machine configuration, so do not add
// L3/20X/other values until captured from this machine.
const OBJECTIVE_TURRET_CODE_BY_VALUE: Record<string, string> = {
  '10X': '1',
  '40X': '2',
};

const OBJECTIVE_VALUE_BY_TURRET_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(OBJECTIVE_TURRET_CODE_BY_VALUE).map(([value, code]) => [code, value])
);

function padInteger(value: string | number, width: number): string | null {
  const numeric = Number(String(value).trim());
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  return String(numeric).padStart(width, '0').slice(-width);
}

const COMMAND_MAP: Partial<Record<MachineCommandKey, CommandMapEntry>> = {
  // Force has a custom builder (buildSetForceCommand) that emits the
  // '#<scale><value:D8>!' frame directly without the global \r terminator.
  // The map entry stays so isCommandVerified('force') reports true; buildFromMap
  // is bypassed for force.
  force: {
    code: '#',
    formatValue: (v) => FORCE_SCALE_CODE_BY_VALUE[String(v).trim()] ?? null,
    verified: true,
  },
  lightness: {
    code: 'UK',
    formatValue: (v) => padInteger(v, 4),
    verified: true,
  },
  loadTime: {
    code: 'UT',
    formatValue: (v) => padInteger(v, 2),
    verified: true,
  },
  objective: {
    code: 'UL',
    formatValue: (v) => OBJECTIVE_TURRET_CODE_BY_VALUE[String(v).toUpperCase().trim()] ?? null,
    verified: true,
  },
  // No hardness-level command was found in Communication.dll.
  hardnessLevel: {
    code: '__TODO__',
    formatValue: () => null,
    verified: false,
  },
  // Communication.dll EncodeImpressCode emits the UV frame used by the original
  // tester software. X means turret-after-impress, matching HV config.
  indent: {
    code: 'UV',
    formatValue: () => null,
    verified: true,
  },
  // Turret buttons in the old software are direction labels bound to configured
  // turret slots. Communication.dll EncodeTurretCode(TurretInfo) emits UL<n>\r
  // and ignores the direction enum after the UI has selected the TurretInfo:
  //   Left slot 1 -> UL1\r
  //   Front/down arrow slot 2 -> UL2\r
  //   Right slot 3 -> UL3\r
  turretLeft: {
    code: 'UL',
    formatValue: () => TURRET_SLOT_BY_DIRECTION.left,
    verified: true,
  },
  turretFront: {
    code: 'UL',
    formatValue: () => TURRET_SLOT_BY_DIRECTION.front,
    verified: true,
  },
  turretRight: {
    code: 'UL',
    formatValue: () => TURRET_SLOT_BY_DIRECTION.right,
    verified: true,
  },
};

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

interface BuildFrameInput {
  command: string;
  value?: string;
}

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
    console.warn(`[machine-protocol] no command map entry for "${key}" - refusing to transmit`);
    return null;
  }
  if (!entry.verified || entry.code === '__TODO__') {
    // eslint-disable-next-line no-console
    console.warn(`[machine-protocol] command "${key}" is not verified yet - refusing to transmit`);
    return null;
  }
  const formatted = value === null ? '' : entry.formatValue(value);
  if (formatted === null) {
    // eslint-disable-next-line no-console
    console.warn(
      `[machine-protocol] command "${key}" has no verified encoding for value "${value}" - refusing to transmit`
    );
    return null;
  }
  return buildFrame({ command: entry.code, value: formatted });
}

export function buildSetForceCommand(value: string | number): FrameOrNull {
  logBuild('setForce', value);
  const trimmed = String(value).trim();
  const scaleCode = FORCE_SCALE_CODE_BY_VALUE[trimmed];
  const realCode = FORCE_REAL_CODE_BY_VALUE[trimmed];
  if (!scaleCode || !realCode) {
    // eslint-disable-next-line no-console
    console.warn(
      `[machine-protocol] no verified force encoding for "${trimmed}" — refusing to transmit`
    );
    return null;
  }
  // 8-digit zero-padded force value, e.g. 0.5kgf -> '00000500'.
  const value8 = String(Number(realCode)).padStart(8, '0');
  // Frame: '#<scale><value:D8>!' — no \r terminator. This is the DLL pattern
  // '#0{scale}{0:D8}!' confirmed by the original Communication.dll.
  const text = `#${scaleCode}${value8}!`;
  return Buffer.from(text, 'ascii');
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

export function buildStartIndentCommand(
  force: string | number,
  loadTime: string | number,
  turretAfterImpress = true
): FrameOrNull {
  logBuild('startIndent', { force, loadTime, turretAfterImpress });
  if (!isCommandVerified('indent')) return null;
  const forceValue = String(force).trim();
  const scaleCode = FORCE_SCALE_CODE_BY_VALUE[forceValue];
  const forceCode = FORCE_REAL_CODE_BY_VALUE[forceValue];
  const loadTimeCode = padInteger(loadTime, 6);
  if (!scaleCode || !forceCode || !loadTimeCode) {
    // eslint-disable-next-line no-console
    console.warn(
      `[machine-protocol] command "indent" has no verified encoding for force="${force}" loadTime="${loadTime}"`
    );
    return null;
  }
  return buildFrame({
    command: 'UV',
    value: `${scaleCode}${forceCode}${loadTimeCode}${turretAfterImpress ? 'X' : 'P'}`,
  });
}

export function buildTurretCommand(direction: TurretDirection): FrameOrNull {
  logBuild('turret', direction);
  // Pass `direction` as the value so the entry's formatValue() actually runs
  // (buildFromMap short-circuits to '' when value is null). The turret entries
  // ignore the argument and emit the verified UL<n> digit themselves.
  return buildFromMap(TURRET_COMMAND_KEY[direction], direction);
}

export function getTurretCommandKey(direction: TurretDirection): MachineCommandKey {
  return TURRET_COMMAND_KEY[direction];
}

export function getTurretSlotForDirection(direction: TurretDirection): string {
  return TURRET_SLOT_BY_DIRECTION[direction];
}

export function getTurretDirectionForSlot(slot: string): TurretDirection | undefined {
  return TURRET_DIRECTION_BY_SLOT[slot];
}

export function getObjectiveForTurretSlot(slot: string): string | undefined {
  return OBJECTIVE_VALUE_BY_TURRET_CODE[slot];
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

export interface ParseResult {
  /** The decoded frame, or unknown if no complete frame is available yet. */
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

function findAsciiLineEnd(buffer: Buffer): { index: number; consumed: number } | null {
  const cr = buffer.indexOf(0x0d);
  const lf = buffer.indexOf(0x0a);
  // '!' (0x21) terminates the force "#<scale><value:D8>!" frame — treat it as
  // an end-of-frame marker but keep the '!' inside the line so classifyFrame
  // can match the full pattern. We pass index = pos of '!' + 1 so the caller's
  // slice(0, index) keeps the '!'.
  const bang = buffer.indexOf(0x21);
  let bestIndex = -1;
  let bestConsumed = 0;
  if (cr >= 0 && (lf < 0 || cr < lf)) {
    bestIndex = cr;
    bestConsumed = buffer[cr + 1] === 0x0a ? cr + 2 : cr + 1;
  } else if (lf >= 0) {
    bestIndex = lf;
    bestConsumed = lf + 1;
  }
  if (bang >= 0 && (bestIndex < 0 || bang < bestIndex)) {
    // Only treat '!' as a terminator if it actually closes a '#…!' frame —
    // otherwise stray exclamation marks in noise could split frames.
    if (buffer[0] === 0x23 /* '#' */) {
      bestIndex = bang + 1; // include '!' in the line
      bestConsumed = bang + 1;
    }
  }
  if (bestIndex < 0) return null;
  return { index: bestIndex, consumed: bestConsumed };
}

function parseAsciiLine(line: Buffer): ParsedMachineFrame {
  const payload = line.toString('ascii').replace(/\r$/, '');
  return classifyFrame(Buffer.from(payload, 'ascii'), payload);
}

function fixedAsciiFrameLength(text: string): number {
  if (text.startsWith('FINISH')) return 'FINISH'.length;
  if (text.startsWith('ACK')) return 'ACK'.length;
  if (text.startsWith('NAK')) return 'NAK'.length;
  if (text.startsWith('OK')) return 'OK'.length;

  const forceWithOk = /^C\d{2}OK/.exec(text);
  if (forceWithOk) return forceWithOk[0].length;
  const force = /^C\d{2}/.exec(text);
  if (force) return force[0].length;

  // '#<scale><value:D8>!' or just '#<scale>!' — variable length up to '!'.
  if (text.startsWith('#')) {
    const bang = text.indexOf('!');
    if (bang > 0) return bang + 1;
  }

  const loadTime = /^T\d{2}/.exec(text);
  if (loadTime) return loadTime[0].length;

  const lightness = /^K\d{4}/.exec(text);
  if (lightness) return lightness[0].length;

  const turret = /^L\dOK/.exec(text);
  if (turret) return turret[0].length;

  if (text.startsWith('AV')) {
    for (const length of [16, 14, 12]) {
      const candidate = text.slice(0, length);
      if (/^AV\d{2}T\d{2}K\d{4}(?:L\d(?:OK)?)?$/.test(candidate)) {
        return length;
      }
    }
  }

  return 0;
}

function tryParseFixedAsciiFrame(buffer: Buffer): ParseResult | null {
  if (!isLikelyAsciiLineChunk(buffer)) return null;
  const text = buffer.toString('ascii');
  const length = fixedAsciiFrameLength(text);
  if (length === 0 || buffer.length < length) return null;
  const payload = buffer.slice(0, length);
  return { frame: classifyFrame(payload, payload.toString('ascii')), consumed: length };
}

export function tryParseOneFrame(buffer: Buffer, config: ProtocolConfig = PROTOCOL_CONFIG): ParseResult {
  if (buffer.length === 0) {
    return { frame: { kind: 'unknown', raw: buffer }, consumed: 0 };
  }

  if (isLikelyAsciiLineChunk(buffer)) {
    const lineEnd = findAsciiLineEnd(buffer);
    if (lineEnd) {
      const line = buffer.slice(0, lineEnd.index);
      return { frame: parseAsciiLine(line), consumed: lineEnd.consumed };
    }
    const fixedFrame = tryParseFixedAsciiFrame(buffer);
    if (fixedFrame) return fixedFrame;
    if (buffer.length < 256) {
      return { frame: { kind: 'unknown', raw: buffer.slice(0, 0) }, consumed: 0 };
    }
  }

  let start = 0;
  if (config.startByte !== null) {
    const idx = buffer.indexOf(config.startByte);
    if (idx < 0) {
      return { frame: { kind: 'unknown', raw: buffer }, consumed: buffer.length };
    }
    start = idx + 1;
  }

  let end: number;
  if (config.endByte !== null) {
    end = buffer.indexOf(config.endByte, start);
    if (end < 0) {
      return { frame: { kind: 'unknown', raw: buffer.slice(0, 0) }, consumed: 0 };
    }
  } else {
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

function classifyFrame(payload: Buffer, text: string): ParsedMachineFrame {
  if (payload.length === 0) return { kind: 'unknown', raw: payload };
  // eslint-disable-next-line no-console
  console.log(`[machine-protocol] rx text=${JSON.stringify(text)} hex=${payload.toString('hex')}`);

  if (text === 'OK' || text === 'ACK' || payload[0] === 0x06) return { kind: 'ack' };
  if (text === 'NAK' || payload[0] === 0x15) return { kind: 'nak' };
  if (text === 'FINISH') return { kind: 'indent-status', status: 'completed' };

  const statusMatch = /^AV(\d{2})T(\d{2})K(\d{4})(?:L(\d)(?:OK)?)?$/.exec(text);
  if (statusMatch) {
    const values: Partial<Record<MachineControlKey, string | number>> = {};
    const force = FORCE_VALUE_BY_SCALE_CODE[statusMatch[1]];
    if (force) values.force = force;
    const loadTime = Number(statusMatch[2]);
    if (loadTime >= 1 && loadTime <= 99) values.loadTime = loadTime;
    const lightness = Number(statusMatch[3]);
    if (lightness >= 0 && lightness <= 10) values.lightness = lightness;
    const objectiveCode = statusMatch[4];
    const turretDirection = objectiveCode ? getTurretDirectionForSlot(objectiveCode) : undefined;
    if (objectiveCode) {
      const objective = OBJECTIVE_VALUE_BY_TURRET_CODE[objectiveCode];
      if (objective) values.objective = objective;
    }
    return Object.keys(values).length > 0 || objectiveCode
      ? { kind: 'state-batch', values, turretSlot: objectiveCode, turretDirection }
      : { kind: 'unknown', raw: payload };
  }

  const objectiveMatch = /^L(\d)OK$/.exec(text);
  if (objectiveMatch) {
    const slot = objectiveMatch[1];
    return {
      kind: 'turret-update',
      slot,
      direction: getTurretDirectionForSlot(slot),
      objective: OBJECTIVE_VALUE_BY_TURRET_CODE[slot],
    };
  }

  // Force echo in the '#<scale><value:D8>!' family. Some firmwares echo just
  // '#<scale>!' (no value), so the value group is optional.
  const hashForceMatch = /^#(\d{2})(\d{1,8})?!?$/.exec(text);
  if (hashForceMatch) {
    const force = FORCE_VALUE_BY_SCALE_CODE[hashForceMatch[1]];
    if (force) {
      return { kind: 'state-update', key: 'force', value: force };
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[machine-force-rx] unmapped # scale code="${hashForceMatch[1]}" raw="${text}" — accepting as ACK`
    );
    return { kind: 'ack' };
  }

  const forceMatch = /^C(\d{2})(?:OK)?$/.exec(text);
  if (forceMatch) {
    const force = FORCE_VALUE_BY_SCALE_CODE[forceMatch[1]];
    if (force) {
      return { kind: 'state-update', key: 'force', value: force };
    }
    // Machine echoed a force/load frame but the scale code isn't in the mapping
    // table. Treat as bare ACK so a pending force write doesn't time out — the
    // dropdown keeps its last confirmed value, but TX is acknowledged.
    // eslint-disable-next-line no-console
    console.warn(
      `[machine-force-rx] unmapped scale code="${forceMatch[1]}" raw="${text}" — accepting as ACK`
    );
    return { kind: 'ack' };
  }

  const loadTimeMatch = /^T(\d{2})$/.exec(text);
  if (loadTimeMatch) {
    const loadTime = Number(loadTimeMatch[1]);
    if (loadTime >= 1 && loadTime <= 99) {
      return { kind: 'state-update', key: 'loadTime', value: loadTime };
    }
    return { kind: 'unknown', raw: payload };
  }

  const lightnessMatch = /^K(\d{4})$/.exec(text);
  if (lightnessMatch) {
    const lightness = Number(lightnessMatch[1]);
    if (lightness >= 0 && lightness <= 10) {
      return { kind: 'state-update', key: 'lightness', value: lightness };
    }
    return { kind: 'unknown', raw: payload };
  }

  return { kind: 'unknown', raw: payload };
}

export function parseMachineMessage(buffer: Buffer): ParsedMachineFrame {
  const { frame } = tryParseOneFrame(buffer);
  // eslint-disable-next-line no-console
  console.log('[machine-protocol] parse result kind=', frame.kind, 'len=', buffer.length);
  return frame;
}
