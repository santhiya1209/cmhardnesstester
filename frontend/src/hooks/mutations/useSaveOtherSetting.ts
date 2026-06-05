import { useCallback, useState } from 'react';
import {
  useCreateOtherSettingMutation,
  useUpdateOtherSettingMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { OtherSetting, OtherSettingSavePayload } from '@/types/otherSetting';

export function useSaveOtherSetting() {
  const [createOtherSetting, createState] = useCreateOtherSettingMutation();
  const [updateOtherSetting, updateState] = useUpdateOtherSettingMutation();
  const [error, setError] = useState<string | null>(null);

  const saveOtherSetting = useCallback(
    async ({ id, values }: OtherSettingSavePayload): Promise<OtherSetting> => {
      setError(null);
      try {
        if (id) return await updateOtherSetting({ id, values }).unwrap();
        return await createOtherSetting(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save other setting.'));
        throw requestError;
      }
    },
    [createOtherSetting, updateOtherSetting]
  );

  return { saveOtherSetting, saving: createState.isLoading || updateState.isLoading, error };
}
