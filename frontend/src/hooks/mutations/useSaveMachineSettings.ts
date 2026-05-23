import { useCallback, useState } from 'react';
import { createMachineSettings } from '@/api/machine';
import { updateMachineSettings } from '@/api/machine';
import type { MachineSettings, MachineSettingsPayload } from '@/types/machineSettings';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type SaveMachineSettingsArgs = {
  id?: string;
  values: MachineSettingsPayload;
};

export function useSaveMachineSettings() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveMachineSettings = useCallback(async ({ id, values }: SaveMachineSettingsArgs): Promise<MachineSettings> => {
    setSaving(true);
    setError(null);

    try {
      if (id) {
        return await updateMachineSettings(id, values);
      }

      return await createMachineSettings(values);
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to save machine settings.');
      setError(message);
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    saveMachineSettings,
    saving,
    error,
  };
}
