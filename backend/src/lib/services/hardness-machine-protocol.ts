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
//   objective 10X -> TX "UL1\r",  machine RX echo/status "L1OK"
//   objective IND -> TX "UL2\r",  machine RX echo/status "L2OK"
//   objective 40X -> TX "UL3\r",  machine RX echo/status "L3OK"
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

// TX frames are all ASCII text terminated by a single \r byte. Force frames
// are the exception — they terminate with '!' and have no \r. The encoders
// build that one inline (buildSetForceCommand). The decoder side is now
// owned by RegexParser in the serial service, so the framing parameters
// that used to live here (startByte, checksum, binary encoding) have been
// retired — none were ever exercised.
export interface ProtocolConfig {
  endByte: number;
}

export const PROTOCOL_CONFIG: ProtocolConfig = {
  endByte: 0x0d,
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

// Current connected tester mapping confirmed from machine notes:
//   UL1 -> 10X (reply L1OK)
//   UL2 -> IND (reply L2OK) — indenter slot, not an objective lens
//   UL3 -> 40X (reply L3OK)
// The DLL confirms UL<n>\r as the turret TX shape; objective-per-turret is
// machine configuration. Earlier code mapped 40X to UL2 — that was wrong and
// has been replaced with the values above.
const OBJECTIVE_TURRET_CODE_BY_VALUE: Record<string, string> = {
  '10X': '1',
  IND: '2',
  '40X': '3',
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

interface BuildFrameInput {
  command: string;
  value?: string;
}

export function buildFrame(input: BuildFrameInput, config: ProtocolConfig = PROTOCOL_CONFIG): Buffer {
  const text = input.command + (input.value ?? '');
  return Buffer.concat([Buffer.from(text, 'ascii'), Buffer.from([config.endByte])]);
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
  // eslint-disable-next-line no-console
  console.log(`[machine-force-map] direction=pc-to-machine value=${trimmed} command=${text}`);
  return Buffer.from(text, 'ascii');
}

/**
 * Map a force dropdown value (e.g. '0.5kgf') to its machine profile code
 * (e.g. 'C08'), or null if the value is not a known force option. Used for
 * code-form ack-match logging; returns null for unknown values (no guessing).
 */
export function forceCodeForValue(value: string | number): string | null {
  const code = FORCE_SCALE_CODE_BY_VALUE[String(value).trim()];
  return code ? `C${code}` : null;
}

export function buildSetLightnessCommand(value: string | number): FrameOrNull {
  const frame = buildFromMap('lightness', value);
  if (frame) {
    // eslint-disable-next-line no-console
    console.log(
      `[machine-lightness-map] direction=pc-to-machine value=${String(value).trim()} command=${frame
        .toString('ascii')
        .replace(/[\r\n]+$/, '')}`
    );
  }
  return frame;
}

/**
 * Map a lightness value (0–10) to its machine echo frame (e.g. 'K0009'), or
 * null if it can't be formatted. Used for code-form ack-match logging only.
 */
export function lightnessFrameForValue(value: string | number): string | null {
  const formatted = padInteger(value, 4);
  return formatted ? `K${formatted}` : null;
}

export function buildSetLoadTimeCommand(value: string | number): FrameOrNull {
  const frame = buildFromMap('loadTime', value);
  if (frame) {
    // eslint-disable-next-line no-console
    console.log(
      `[machine-loadtime-map] direction=pc-to-machine value=${String(value).trim()} command=${frame
        .toString('ascii')
        .replace(/[\r\n]+$/, '')}`
    );
  }
  return frame;
}

/**
 * Map a load-time value to its machine echo frame (e.g. 'T04'), or null if it
 * can't be formatted. Used for code-form ack-match logging only.
 */
export function loadTimeFrameForValue(value: string | number): string | null {
  const formatted = padInteger(value, 2);
  return formatted ? `T${formatted}` : null;
}

export function buildSetObjectiveCommand(value: string | number): FrameOrNull {
  return buildFromMap('objective', value);
}

/**
 * Map an objective value (e.g. '40X') to the machine echo frame that confirms
 * it (e.g. 'L3OK'), or null for an unmapped value. Used for ack-match logging
 * so the expected RX is shown in the same form the machine actually sends.
 */
export function objectiveFrameForValue(value: string | number): string | null {
  const code = OBJECTIVE_TURRET_CODE_BY_VALUE[String(value).toUpperCase().trim()];
  return code ? `L${code}OK` : null;
}

export function buildSetHardnessLevelCommand(value: string | number): FrameOrNull {
  return buildFromMap('hardnessLevel', value);
}

export function buildStartIndentCommand(
  force: string | number,
  loadTime: string | number,
  turretAfterImpress = true
): FrameOrNull {
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

/**
 * Interpret one complete frame already extracted by the serialport
 * RegexParser. The parser strips the terminator (\r / \n / !) before
 * delivering the frame, so all we do here is normalise any residual
 * trailing CR/LF and hand off to classifyFrame for content classification.
 */
export function parseFrame(frame: Buffer): ParsedMachineFrame {
  // Normalise before matching: strip residual CR/LF, trim surrounding spaces,
  // and upper-case so the machine's echo (e.g. ' l3ok\r') matches the L<n>OK /
  // OK patterns regardless of casing or stray whitespace.
  const text = frame.toString('ascii').replace(/[\r\n]+$/, '').trim().toUpperCase();
  if (text.length === 0) return { kind: 'unknown', raw: frame };
  return classifyFrame(Buffer.from(text, 'ascii'), text);
}

function classifyFrame(payload: Buffer, text: string): ParsedMachineFrame {
  if (payload.length === 0) return { kind: 'unknown', raw: payload };

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
    const direction = getTurretDirectionForSlot(slot);
    const objective = OBJECTIVE_VALUE_BY_TURRET_CODE[slot];
    if (!direction || !objective) {
      // eslint-disable-next-line no-console
      console.warn(`[machine-objective-rx] unknown turret slot="${slot}" raw="${text}" — ignored`);
      return { kind: 'unknown', raw: payload };
    }
    return {
      kind: 'turret-update',
      slot,
      direction,
      objective,
    };
  }

  // Force echo in the '#<scale><value:D8>!' family. Some firmwares echo just
  // '#<scale>!' (no value), so the value group is optional.
  const hashForceMatch = /^#(\d{2})(\d{1,8})?!?$/.exec(text);
  if (hashForceMatch) {
    const force = FORCE_VALUE_BY_SCALE_CODE[hashForceMatch[1]];
    if (force) {
      // eslint-disable-next-line no-console
      console.log(`[machine-force-map] direction=machine-to-pc frame=${text} value=${force}`);
      return { kind: 'state-update', key: 'force', value: force };
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[machine-force-rx] unmapped # scale code="${hashForceMatch[1]}" raw="${text}" — ignored`
    );
    return { kind: 'unknown', raw: payload };
  }

  const forceMatch = /^C(\d{2})(?:OK)?$/.exec(text);
  if (forceMatch) {
    const force = FORCE_VALUE_BY_SCALE_CODE[forceMatch[1]];
    if (force) {
      // eslint-disable-next-line no-console
      console.log(`[machine-force-map] direction=machine-to-pc frame=${text} value=${force}`);
      return { kind: 'state-update', key: 'force', value: force };
    }
    // Unknown force code: do NOT treat as success. Log it and ignore the frame
    // so the dropdown keeps its previous confirmed value (and a pending PC force
    // write times out → keeps the last value rather than committing a wrong one).
    // eslint-disable-next-line no-console
    console.warn(`[machine-force-rx] unknown force code="C${forceMatch[1]}" raw="${text}" — ignored`);
    return { kind: 'unknown', raw: payload };
  }

  const loadTimeMatch = /^T(\d{2})$/.exec(text);
  if (loadTimeMatch) {
    const loadTime = Number(loadTimeMatch[1]);
    if (loadTime >= 1 && loadTime <= 99) {
      // eslint-disable-next-line no-console
      console.log(`[machine-loadtime-map] direction=machine-to-pc frame=${text} value=${loadTime}`);
      return { kind: 'state-update', key: 'loadTime', value: loadTime };
    }
    // Out-of-range load time: log and ignore. Never treated as success.
    // eslint-disable-next-line no-console
    console.warn(`[machine-loadtime-rx] invalid load-time frame="${text}" — ignored`);
    return { kind: 'unknown', raw: payload };
  }

  const lightnessMatch = /^K(\d{4})$/.exec(text);
  if (lightnessMatch) {
    const lightness = Number(lightnessMatch[1]);
    if (lightness >= 0 && lightness <= 10) {
      // eslint-disable-next-line no-console
      console.log(`[machine-lightness-map] direction=machine-to-pc frame=${text} value=${lightness}`);
      return { kind: 'state-update', key: 'lightness', value: lightness };
    }
    // Out-of-range lightness: log and ignore. Never treated as success, so a
    // pending PC lightness write times out and the previous value is kept.
    // eslint-disable-next-line no-console
    console.warn(`[machine-lightness-rx] invalid lightness frame="${text}" — ignored`);
    return { kind: 'unknown', raw: payload };
  }

  return { kind: 'unknown', raw: payload };
}
