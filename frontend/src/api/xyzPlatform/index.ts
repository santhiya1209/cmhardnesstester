import type {
  XYZPlatformState,
  XYZPlatformStatePayload,
} from '@/types/xyzPlatformState';
import type {
  FocusMode,
  XyzCommandResult,
  XyzDiagnoseResult,
  XyzDirection,
  XyzLineControlResult,
  XyzProbeOptions,
  XyzProbeResult,
  XyzStageState,
  XySpeed,
  ZDirection,
  ZSpeed,
} from '@/types/xyzPlatform';
import { apiClient } from '../_client';

export const getXyzPlatformStates = () =>
  apiClient.get<XYZPlatformState[]>('/api/xyz-platform-states');

export const createXyzPlatformState = (payload: XYZPlatformStatePayload) =>
  apiClient.post<XYZPlatformState>('/api/xyz-platform-states', payload);

export const updateXyzPlatformState = (id: string, payload: XYZPlatformStatePayload) =>
  apiClient.put<XYZPlatformState>(`/api/xyz-platform-states/${id}`, payload);

const BRIDGE_UNAVAILABLE: XyzCommandResult = {
  ok: false,
  error: 'XYZ_BRIDGE_UNAVAILABLE',
  message: 'XYZ platform hardware bridge is unavailable (not running in Electron).',
};

function bridge(): NonNullable<typeof window.xyzPlatform> | null {
  return window.xyzPlatform ?? null;
}

/** Lightweight connect/disconnect result — the live state still arrives via the subscription. */
export type XyzConnectResult = { ok: boolean; error?: string; message?: string };

const BRIDGE_UNAVAILABLE_CONNECT: XyzConnectResult = {
  ok: false,
  error: 'XYZ_BRIDGE_UNAVAILABLE',
  message: 'XYZ platform hardware bridge is unavailable (not running in Electron).',
};

export const xyzConnect = (opts: { port: string }): Promise<XyzConnectResult> => {
  const b = bridge();
  if (!b) return Promise.resolve(BRIDGE_UNAVAILABLE_CONNECT);
  return b.connect(opts).then((res) => ({ ok: res.ok, error: res.error, message: res.message }));
};

export const xyzDisconnect = (): Promise<XyzConnectResult> => {
  const b = bridge();
  if (!b) return Promise.resolve(BRIDGE_UNAVAILABLE_CONNECT);
  return b.disconnect().then((res) => ({ ok: res.ok, error: res.error, message: res.message }));
};

const BRIDGE_UNAVAILABLE_DIAGNOSE: XyzDiagnoseResult = {
  ok: false,
  error: 'XYZ_BRIDGE_UNAVAILABLE',
  port: null,
  open: null,
  anyRx: false,
  probes: [],
  summary: 'XYZ platform hardware bridge is unavailable (not running in Electron).',
};

/** Hardware diagnostic — sends safe non-moving probes and reports any RX. Inspect the `[xyz-probe-*]` logs. */
export const xyzDiagnose = (): Promise<XyzDiagnoseResult> =>
  bridge()?.diagnose() ?? Promise.resolve(BRIDGE_UNAVAILABLE_DIAGNOSE);

const BRIDGE_UNAVAILABLE_LINE_CONTROL: XyzLineControlResult = {
  ok: false,
  error: 'XYZ_BRIDGE_UNAVAILABLE',
  port: null,
  open: null,
  supported: false,
  anyRx: false,
  configs: [],
  summary: 'XYZ platform hardware bridge is unavailable (not running in Electron).',
};

/** RTS/DTR line-control diagnostic — sweeps the four combos sending safe #10!. Inspect the `[xyz-line-control*]` logs. */
export const xyzTestLineControl = (): Promise<XyzLineControlResult> =>
  bridge()?.testLineControl() ?? Promise.resolve(BRIDGE_UNAVAILABLE_LINE_CONTROL);

/**
 * Expert manual probe (dev console only — not wired to any UI control).
 * ⚠ WARNING: a moving command (e.g. "#0C+00000001!") WILL physically move the stage.
 */
export const xyzProbe = (commandText: string, options?: XyzProbeOptions): Promise<XyzProbeResult> =>
  bridge()?.probe(commandText, options) ??
  Promise.resolve({
    label: 'bridge-unavailable',
    tx: commandText,
    txHex: '',
    rx: null,
    error: 'XYZ_BRIDGE_UNAVAILABLE',
  });

export const xyzMoveStage = (direction: XyzDirection, speed: XySpeed): Promise<XyzCommandResult> =>
  bridge()?.moveStage(direction, speed) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzStopStage = (): Promise<XyzCommandResult> =>
  bridge()?.stopStage() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzMoveZ = (direction: ZDirection, speed: ZSpeed): Promise<XyzCommandResult> =>
  bridge()?.moveZ(direction, speed) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzStopZ = (): Promise<XyzCommandResult> =>
  bridge()?.stopZ() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzLockZ = (): Promise<XyzCommandResult> =>
  bridge()?.lockZ() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzUnlockZ = (): Promise<XyzCommandResult> =>
  bridge()?.unlockZ() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzLockXy = (): Promise<XyzCommandResult> =>
  bridge()?.lockXy() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzUnlockXy = (): Promise<XyzCommandResult> =>
  bridge()?.unlockXy() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzSetFocusMode = (mode: FocusMode): Promise<XyzCommandResult> =>
  bridge()?.setFocusMode(mode) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzSetXySpeed = (speed: XySpeed): Promise<XyzCommandResult> =>
  bridge()?.setXySpeed(speed) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzSetZSpeed = (speed: ZSpeed): Promise<XyzCommandResult> =>
  bridge()?.setZSpeed(speed) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzGetPosition = (): Promise<XyzCommandResult> =>
  bridge()?.getPosition() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzMoveToCenter = (): Promise<XyzCommandResult> =>
  bridge()?.moveToCenter() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzLocateCenter = (): Promise<XyzCommandResult> =>
  bridge()?.locateCenter() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

/** Subscribe to live stage-state pushes. Returns an unsubscribe fn (no-op outside Electron). */
export const subscribeXyzStageState = (listener: (state: XyzStageState) => void): (() => void) =>
  bridge()?.subscribeState(listener) ?? (() => {});
