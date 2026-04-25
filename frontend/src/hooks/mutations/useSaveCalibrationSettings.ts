import { useCallback, useState } from 'react';
import { createCalibrationSettings } from '@/api/createCalibrationSettings';
import { updateCalibrationSettings } from '@/api/updateCalibrationSettings';
import type {
  CalibrationSettings,
  CalibrationSettingsSavePayload,
} from '@/types/calibrationSettings';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type SaveCalibrationSettingsArgs = {
  id?: string;
  values: CalibrationSettingsSavePayload;
};

export function useSaveCalibrationSettings() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveCalibrationSettings = useCallback(
    async ({ id, values }: SaveCalibrationSettingsArgs): Promise<CalibrationSettings> => {
      setSaving(true);
      setError(null);

      try {
        if (id) {
          return await updateCalibrationSettings(id, values);
        }

        return await createCalibrationSettings(values);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save calibration settings.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    saveCalibrationSettings,
    saving,
    error,
  };
}
