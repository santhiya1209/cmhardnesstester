import { useCallback } from 'react';
import { getCameraSetting } from '@/api/camera';
import { dropPendingCameraFrames } from '@/hooks/cameraStreamManager';

export interface UseCameraSettingsRestoreInput {
  refetchCameraSetting: () => Promise<void> | void;
}

export interface CameraSettingsRestoreApi {
  restoreCameraSettings: () => Promise<void>;
}

export function useCameraSettingsRestore(
  input: UseCameraSettingsRestoreInput
): CameraSettingsRestoreApi {
  const { refetchCameraSetting } = input;

  const restoreCameraSettings = useCallback(async () => {
    try {
      const items = await getCameraSetting();
      const saved =
        items.length > 0
          ? [...items].sort(
              (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
            )[0]
          : null;
      if (saved) {
        // eslint-disable-next-line no-console
        console.log(`[camera-settings-restore] gain=${saved.analogGain} exposure=${saved.exposureTimeMs}`);
        // eslint-disable-next-line no-console
        console.log(`[camera-settings-persist][load] key=gain value=${saved.analogGain}`);
        // eslint-disable-next-line no-console
        console.log(`[camera-settings-persist][load] key=exposure value=${saved.exposureTimeMs}`);
        // eslint-disable-next-line no-console
        console.log(`[camera-restore] gain=${saved.analogGain}`);
        // eslint-disable-next-line no-console
        console.log(`[camera-restore] exposure=${saved.exposureTimeMs}`);
        let gainOk = false;
        try {
          dropPendingCameraFrames('gain-change');
          // eslint-disable-next-line no-console
          console.log(`[camera-settings-persist][apply-ready] key=gain value=${saved.analogGain}`);
          const gainReply = await window.hardnessCamera.setGain(saved.analogGain);
          if (gainReply.ok && typeof gainReply.gain === 'number') {
            gainOk = true;
            // eslint-disable-next-line no-console
            console.log(`[camera-settings-persist][verify] key=gain value=${gainReply.gain}`);
          } else {
            // eslint-disable-next-line no-console
            console.error('[camera-settings-persist][error] startup gain apply failed', gainReply);
          }
        } catch (gainErr) {
          // eslint-disable-next-line no-console
          console.error('[camera-settings-persist][error] startup gain apply threw', gainErr);
        }
        let expOk = false;
        try {
          dropPendingCameraFrames('exposure-change');
          // eslint-disable-next-line no-console
          console.log(`[camera-settings-persist][apply-ready] key=exposure value=${saved.exposureTimeMs}`);
          const expReply = await window.hardnessCamera.setExposure(saved.exposureTimeMs);
          if (expReply.ok && typeof expReply.exposureMs === 'number') {
            expOk = true;
            // eslint-disable-next-line no-console
            console.log(`[camera-settings-persist][verify] key=exposure value=${expReply.exposureMs}`);
          } else {
            // eslint-disable-next-line no-console
            console.error('[camera-settings-persist][error] startup exposure apply failed', expReply);
          }
        } catch (expErr) {
          // eslint-disable-next-line no-console
          console.error('[camera-settings-persist][error] startup exposure apply threw', expErr);
        }
        if (gainOk && expOk) {
          // eslint-disable-next-line no-console
          console.log('[camera-restore] apply-success');
        }
      } else {
        // eslint-disable-next-line no-console
        console.log('[camera-settings-persist][load] no saved settings — SDK defaults will remain');
      }
    } catch (loadErr) {
      // eslint-disable-next-line no-console
      console.error('[camera-settings-error] failed to load saved settings', loadErr);
    }
    try {
      await refetchCameraSetting();
    } catch {
    }
  }, [refetchCameraSetting]);

  return { restoreCameraSettings };
}
