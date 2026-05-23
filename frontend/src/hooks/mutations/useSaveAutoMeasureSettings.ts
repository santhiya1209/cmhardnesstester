import { useCallback, useState } from 'react';
import { createAutoMeasureSettings } from '@/api/settings';
import { updateAutoMeasureSettings } from '@/api/settings';
import type {
  AutoMeasureSettings,
  AutoMeasureSettingsPayload,
} from '@/types/autoMeasureSettings';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type SaveAutoMeasureSettingsArgs = {
  id?: string;
  values: AutoMeasureSettingsPayload;
};

export function useSaveAutoMeasureSettings() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveAutoMeasureSettings = useCallback(
    async ({ id, values }: SaveAutoMeasureSettingsArgs): Promise<AutoMeasureSettings> => {
      setSaving(true);
      setError(null);

      try {
        if (id) {
          return await updateAutoMeasureSettings(id, values);
        }

        return await createAutoMeasureSettings(values);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save auto measure settings.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    saveAutoMeasureSettings,
    saving,
    error,
  };
}
