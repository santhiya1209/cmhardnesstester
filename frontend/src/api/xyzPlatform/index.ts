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
  XyzZDiagnoseResult,
  XySpeed,
  ZDirection,
  ZSpeed,
} from '@/types/xyzPlatform';
import type {
  ImageSelection,
  ZAxisSettingsPayload,
  ZAxisSettingsResult,
} from '@/types/zAxisSettings';
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

export const xyzMoveStage = (direction: XyzDirection): Promise<XyzCommandResult> =>
  bridge()?.moveStage(direction) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

/** Quick tap: one finite configured step move, RX-gated. */
export const xyzMoveStep = (direction: XyzDirection): Promise<XyzCommandResult> =>
  bridge()?.moveStep(direction) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzStopStage = (): Promise<XyzCommandResult> =>
  bridge()?.stopStage() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzMoveZ = (direction: ZDirection, speed: ZSpeed): Promise<XyzCommandResult> =>
  bridge()?.moveZ(direction, speed) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzStopZ = (): Promise<XyzCommandResult> =>
  bridge()?.stopZ() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

/** Open the dedicated Z serial connection on the configured Z port (no fallback). */
export const xyzConnectZ = (opts: { port: string; baudRate?: number }): Promise<XyzConnectResult> => {
  const b = bridge();
  if (!b) return Promise.resolve(BRIDGE_UNAVAILABLE_CONNECT);
  return b.connectZ(opts).then((res) => ({ ok: res.ok, error: res.error, message: res.message }));
};

export const xyzDisconnectZ = (): Promise<XyzConnectResult> => {
  const b = bridge();
  if (!b) return Promise.resolve(BRIDGE_UNAVAILABLE_CONNECT);
  return b.disconnectZ().then((res) => ({ ok: res.ok, error: res.error, message: res.message }));
};

export const xyzStartZJog = (direction: ZDirection): Promise<XyzCommandResult> =>
  bridge()?.startZJog(direction) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzStopZJog = (): Promise<XyzCommandResult> =>
  bridge()?.stopZJog() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

export const xyzPollZStatus = (): Promise<XyzCommandResult> =>
  bridge()?.pollZStatus() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

const BRIDGE_UNAVAILABLE_Z_DIAGNOSE: XyzZDiagnoseResult = {
  ok: false,
  error: 'XYZ_BRIDGE_UNAVAILABLE',
  port: null,
  baudRate: null,
  anyRx: false,
  probes: [],
  summary: 'XYZ platform hardware bridge is unavailable (not running in Electron).',
};

/** Dev diagnostic for the Z axis — runs the legacy command sequence; inspect [z-*] logs. */
export const xyzDiagnoseZ = (
  options?: { includeJog?: boolean; speedRegisterValue?: number }
): Promise<XyzZDiagnoseResult> =>
  bridge()?.diagnoseZ(options) ?? Promise.resolve(BRIDGE_UNAVAILABLE_Z_DIAGNOSE);

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

/** Relocate to the taught optical center. Optional homeBeforeRelocation (default off). */
export const xyzMoveToCenter = (opts?: { homeBeforeRelocation?: boolean }): Promise<XyzCommandResult> =>
  bridge()?.moveToCenter(opts) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

/** Relocate to the taught optical center. Optional homeBeforeRelocation (default off). */
export const xyzLocateCenter = (opts?: { homeBeforeRelocation?: boolean }): Promise<XyzCommandResult> =>
  bridge()?.locateCenter(opts) ?? Promise.resolve(BRIDGE_UNAVAILABLE);

/** Teach: capture the current position as the optical center and persist it. */
export const xyzSetCenter = (): Promise<XyzCommandResult> =>
  bridge()?.setCenter() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

/** Dedicated hardware home (#12!) — separate from Relocation. */
export const xyzHome = (): Promise<XyzCommandResult> =>
  bridge()?.home() ?? Promise.resolve(BRIDGE_UNAVAILABLE);

/** Subscribe to live stage-state pushes. Returns an unsubscribe fn (no-op outside Electron). */
export const subscribeXyzStageState = (listener: (state: XyzStageState) => void): (() => void) =>
  bridge()?.subscribeState(listener) ?? (() => {});

// ── Z Axis settings (backend-owned config singleton; no hardware movement) ──
const Z_SETTINGS_BRIDGE_UNAVAILABLE: ZAxisSettingsResult = {
  ok: false,
  error: 'XYZ_BRIDGE_UNAVAILABLE',
  message: 'XYZ platform hardware bridge is unavailable (not running in Electron).',
};

export const getZAxisSettings = (): Promise<ZAxisSettingsResult> =>
  bridge()?.getZSettings() ?? Promise.resolve(Z_SETTINGS_BRIDGE_UNAVAILABLE);

export const saveZAxisSettings = (settings: ZAxisSettingsPayload): Promise<ZAxisSettingsResult> =>
  bridge()?.saveZSettings(settings) ?? Promise.resolve(Z_SETTINGS_BRIDGE_UNAVAILABLE);

export const previewZAxisImageSelection = (
  imageSelection: ImageSelection
): Promise<ZAxisSettingsResult> =>
  bridge()?.previewZSettings(imageSelection) ?? Promise.resolve(Z_SETTINGS_BRIDGE_UNAVAILABLE);

export const revertZAxisSettings = (): Promise<ZAxisSettingsResult> =>
  bridge()?.revertZSettings() ?? Promise.resolve(Z_SETTINGS_BRIDGE_UNAVAILABLE);
