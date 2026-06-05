import { useCallback, useState } from 'react';
import {
  useCreateCalibrationSettingsMutation,
  useUpdateCalibrationSettingsMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { CalibrationSettings, CalibrationSettingsSavePayload } from '@/types/calibrationSettings';

type SaveCalibrationSettingsArgs = {
  id?: string;
  values: CalibrationSettingsSavePayload;
};

export function useSaveCalibrationSettings() {
  const [createCalibrationSettings, createState] = useCreateCalibrationSettingsMutation();
  const [updateCalibrationSettings, updateState] = useUpdateCalibrationSettingsMutation();
  const [error, setError] = useState<string | null>(null);

  const saveCalibrationSettings = useCallback(
    async ({ id, values }: SaveCalibrationSettingsArgs): Promise<CalibrationSettings> => {
      setError(null);
      try {
        if (id) return await updateCalibrationSettings({ id, values }).unwrap();
        return await createCalibrationSettings(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save calibration settings.'));
        throw requestError;
      }
    },
    [createCalibrationSettings, updateCalibrationSettings]
  );

  return {
    saveCalibrationSettings,
    saving: createState.isLoading || updateState.isLoading,
    error,
  };
}
