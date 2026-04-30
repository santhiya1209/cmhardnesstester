import { useCallback, useState } from 'react';
import { createCameraSetting } from '@/api/createCameraSetting';
import { updateCameraSetting } from '@/api/updateCameraSetting';
import type {
  CameraSetting,
  CameraSettingPayload,
  CameraSettingSavePayload,
} from '@/types/cameraSetting';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useSaveCameraSetting() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveCameraSetting = useCallback(
    async ({ id, values }: CameraSettingSavePayload): Promise<CameraSetting> => {
      setSaving(true);
      setError(null);

      try {
        const payload: CameraSettingPayload = {
          analogGain: values.analogGain,
          exposureTimeMs: values.exposureTimeMs,
        };
        if (id) {
          return await updateCameraSetting(id, payload);
        }
        return await createCameraSetting(payload);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save camera setting.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return { saveCameraSetting, saving, error };
}
