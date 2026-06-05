import { useCallback, useState } from 'react';
import {
  useCreateCameraSettingMutation,
  useUpdateCameraSettingMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type {
  CameraSetting,
  CameraSettingPayload,
  CameraSettingSavePayload,
} from '@/types/cameraSetting';

export function useSaveCameraSetting() {
  const [createCameraSetting, createState] = useCreateCameraSettingMutation();
  const [updateCameraSetting, updateState] = useUpdateCameraSettingMutation();
  const [error, setError] = useState<string | null>(null);

  const saveCameraSetting = useCallback(
    async ({ id, values }: CameraSettingSavePayload): Promise<CameraSetting> => {
      setError(null);
      const payload: CameraSettingPayload = {
        analogGain: values.analogGain,
        exposureTimeMs: values.exposureTimeMs,
      };
      try {
        if (id) return await updateCameraSetting({ id, values: payload }).unwrap();
        return await createCameraSetting(payload).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save camera setting.'));
        throw requestError;
      }
    },
    [createCameraSetting, updateCameraSetting]
  );

  return { saveCameraSetting, saving: createState.isLoading || updateState.isLoading, error };
}
