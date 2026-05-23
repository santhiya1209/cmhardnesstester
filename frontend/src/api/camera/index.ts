import type { CameraSetting, CameraSettingPayload } from '@/types/cameraSetting';
import type { IpcInvokeMap } from '@/types/ipc';
import { apiClient } from '../_client';

// IPC operations (renderer ↔ main process). These are NOT CRUD; they drive the
// camera native module via `window.api.invoke`. They live alongside the CRUD
// camera-setting endpoints because both belong to the same `camera` domain.

export const openCamera = (index = 0): Promise<IpcInvokeMap['camera:open']['response']> =>
  window.api.invoke('camera:open', { index });

export const closeCamera = (): Promise<IpcInvokeMap['camera:close']['response']> =>
  window.api.invoke('camera:close');

export const getCameraFrame = (
  timeoutMs = 4000
): Promise<IpcInvokeMap['camera:get-frame']['response']> =>
  window.api.invoke('camera:get-frame', { timeoutMs });

export const getCameraStatus = (): Promise<IpcInvokeMap['camera:get-status']['response']> =>
  window.api.invoke('camera:get-status');

export const startCameraStream = (): Promise<IpcInvokeMap['camera:start-stream']['response']> => {
  // eslint-disable-next-line no-console
  console.log('[camera-ui][start-stream]');
  return window.api.invoke('camera:start-stream');
};

export const stopCameraStream = (): Promise<IpcInvokeMap['camera:stop-stream']['response']> =>
  window.api.invoke('camera:stop-stream');

export const setCameraExposure = (
  valueMs: number
): Promise<IpcInvokeMap['camera:set-exposure']['response']> =>
  window.api.invoke('camera:set-exposure', { valueMs });

export const setCameraGain = (
  value: number
): Promise<IpcInvokeMap['camera:set-gain']['response']> =>
  window.api.invoke('camera:set-gain', { value });

export const setCameraTriggerMode = (
  value: boolean
): Promise<IpcInvokeMap['camera:set-trigger-mode']['response']> =>
  window.api.invoke('camera:set-trigger-mode', { value });

/**
 * Fire-and-forget ack so the main process can release its in-flight slot
 * and send the next frame. Called from the camera stream paint handler
 * right after pixels land on the canvas.
 */
export function ackCameraFrame(frameId: number): void {
  if (!frameId) return;
  void window.api.invoke('camera:frame-ack', { frameId }).catch(() => {
    /* ack is best-effort; main process has a 200ms timeout fallback */
  });
}

/**
 * Tell the main process to mark all in-flight / pending frames as stale.
 * Used at objective change (10X/40X) so SDK-buffered frames captured before
 * the swap don't get rendered after the canvas clear.
 */
export function flushCameraStream(reason = 'objective-change'): void {
  void window.api.invoke('camera:flush-stream', { reason }).catch(() => {
    /* best-effort */
  });
}

/**
 * Live-mode exposure helper. The DVP SDK exposes no SetFrameRate; the only
 * way to raise live FPS is to lower exposure. This converts a target FPS
 * into an exposure value and applies it via setCameraExposure.
 *
 * Use only for live preview. Auto Measure / snapshot capture has its own
 * frame path (`measureVickersAuto` → `cameraGetFrame`) and is unaffected.
 */
export function setLiveExposureForFps(targetFps: number) {
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    return Promise.reject(new Error(`targetFps must be > 0 (got ${targetFps})`));
  }
  const exposureMs = 1000 / targetFps;
  return setCameraExposure(exposureMs);
}

// Camera-setting CRUD (HTTP)
export const getCameraSetting = () =>
  apiClient.get<CameraSetting[]>('/api/camera-setting');

export const createCameraSetting = (payload: CameraSettingPayload) =>
  apiClient.post<CameraSetting>('/api/camera-setting', payload);

export const updateCameraSetting = (id: string, payload: CameraSettingPayload) =>
  apiClient.put<CameraSetting>(`/api/camera-setting/${id}`, payload);
