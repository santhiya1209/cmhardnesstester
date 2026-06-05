import type {
  XYZPlatformState,
  XYZPlatformStatePayload,
} from '@/types/xyzPlatformState';
import type {
  FocusMode,
  XyzCommandResult,
  XyzDirection,
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
