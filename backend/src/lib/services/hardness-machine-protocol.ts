// Hardness machine RS232 protocol adapter.
//
// Until the official RS232 protocol manual is provided, every command builder
// returns null and parseMachineMessage returns { kind: 'unknown' }. The service
// layer treats null as "do not transmit" — this is intentional. DO NOT GUESS
// command bytes — sending wrong frames could damage the machine or its load
// cell.

export type MachineControlKey =
  | 'force'
  | 'lightness'
  | 'loadTime'
  | 'objective'
  | 'hardnessLevel';

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

function logBuild(name: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log('[machine-protocol] build command', name, value);
}

export function buildSetForceCommand(value: string | number): FrameOrNull {
  logBuild('setForce', value);
  // TODO(protocol): Replace with real frame once manual is provided.
  return null;
}

export function buildSetLightnessCommand(value: string | number): FrameOrNull {
  logBuild('setLightness', value);
  // TODO(protocol)
  return null;
}

export function buildSetLoadTimeCommand(value: string | number): FrameOrNull {
  logBuild('setLoadTime', value);
  // TODO(protocol)
  return null;
}

export function buildSetObjectiveCommand(value: string | number): FrameOrNull {
  logBuild('setObjective', value);
  // TODO(protocol)
  return null;
}

export function buildSetHardnessLevelCommand(value: string | number): FrameOrNull {
  logBuild('setHardnessLevel', value);
  // TODO(protocol)
  return null;
}

export function buildStartIndentCommand(): FrameOrNull {
  logBuild('startIndent', null);
  // TODO(protocol): Indent triggers physical motion. NEVER guess bytes here.
  // Returning null causes the service to refuse to transmit.
  return null;
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

export function verifyChecksum(_buffer: Buffer): boolean {
  // TODO(protocol): real checksum once framing is known.
  // eslint-disable-next-line no-console
  console.log('[machine-protocol] checksum valid (stub: always true)');
  return true;
}

export function parseMachineMessage(buffer: Buffer): ParsedMachineFrame {
  // eslint-disable-next-line no-console
  console.log('[machine-protocol] parse frame len=', buffer.length);
  // TODO(protocol): real parser. For now return unknown so the service logs
  // RX without acting on it.
  return { kind: 'unknown', raw: buffer };
}
