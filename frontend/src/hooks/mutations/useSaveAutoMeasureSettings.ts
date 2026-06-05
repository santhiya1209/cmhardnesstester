import { useCallback, useState } from 'react';
import {
  useCreateAutoMeasureSettingsMutation,
  useUpdateAutoMeasureSettingsMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { AutoMeasureSettings, AutoMeasureSettingsPayload } from '@/types/autoMeasureSettings';

type SaveAutoMeasureSettingsArgs = {
  id?: string;
  values: AutoMeasureSettingsPayload;
};

export function useSaveAutoMeasureSettings() {
  const [createAutoMeasureSettings, createState] = useCreateAutoMeasureSettingsMutation();
  const [updateAutoMeasureSettings, updateState] = useUpdateAutoMeasureSettingsMutation();
  const [error, setError] = useState<string | null>(null);

  const saveAutoMeasureSettings = useCallback(
    async ({ id, values }: SaveAutoMeasureSettingsArgs): Promise<AutoMeasureSettings> => {
      setError(null);
      try {
        if (id) return await updateAutoMeasureSettings({ id, values }).unwrap();
        return await createAutoMeasureSettings(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save auto measure settings.'));
        throw requestError;
      }
    },
    [createAutoMeasureSettings, updateAutoMeasureSettings]
  );

  return {
    saveAutoMeasureSettings,
    saving: createState.isLoading || updateState.isLoading,
    error,
  };
}
