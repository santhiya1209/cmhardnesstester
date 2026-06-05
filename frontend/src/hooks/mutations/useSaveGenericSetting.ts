import { useCallback, useState } from 'react';
import {
  useCreateGenericSettingMutation,
  useUpdateGenericSettingMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { GenericSetting, GenericSettingSavePayload } from '@/types/genericSetting';

export function useSaveGenericSetting() {
  const [createGenericSetting, createState] = useCreateGenericSettingMutation();
  const [updateGenericSetting, updateState] = useUpdateGenericSettingMutation();
  const [error, setError] = useState<string | null>(null);

  const saveGenericSetting = useCallback(
    async ({ id, values }: GenericSettingSavePayload): Promise<GenericSetting> => {
      setError(null);
      try {
        if (id) return await updateGenericSetting({ id, values }).unwrap();
        return await createGenericSetting(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save generic setting.'));
        throw requestError;
      }
    },
    [createGenericSetting, updateGenericSetting]
  );

  return { saveGenericSetting, saving: createState.isLoading || updateState.isLoading, error };
}
