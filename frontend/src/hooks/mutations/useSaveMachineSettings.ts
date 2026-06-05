import { useCallback, useState } from 'react';
import {
  useCreateMachineSettingsMutation,
  useUpdateMachineSettingsMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { MachineSettings, MachineSettingsPayload } from '@/types/machineSettings';

type SaveMachineSettingsArgs = {
  id?: string;
  values: MachineSettingsPayload;
};

export function useSaveMachineSettings() {
  const [createMachineSettings, createState] = useCreateMachineSettingsMutation();
  const [updateMachineSettings, updateState] = useUpdateMachineSettingsMutation();
  const [error, setError] = useState<string | null>(null);

  const saveMachineSettings = useCallback(
    async ({ id, values }: SaveMachineSettingsArgs): Promise<MachineSettings> => {
      setError(null);
      try {
        if (id) return await updateMachineSettings({ id, values }).unwrap();
        return await createMachineSettings(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save machine settings.'));
        throw requestError;
      }
    },
    [createMachineSettings, updateMachineSettings]
  );

  return {
    saveMachineSettings,
    saving: createState.isLoading || updateState.isLoading,
    error,
  };
}
