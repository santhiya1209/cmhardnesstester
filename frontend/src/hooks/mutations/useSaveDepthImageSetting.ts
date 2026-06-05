import { useCallback, useState } from 'react';
import {
  useCreateDepthImageSettingMutation,
  useUpdateDepthImageSettingMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { DepthImageSetting, DepthImageSettingPayload } from '@/types/depthImageSetting';

type SaveDepthImageSettingArgs = {
  id?: string;
  values: DepthImageSettingPayload;
};

export function useSaveDepthImageSetting() {
  const [createDepthImageSetting, createState] = useCreateDepthImageSettingMutation();
  const [updateDepthImageSetting, updateState] = useUpdateDepthImageSettingMutation();
  const [error, setError] = useState<string | null>(null);

  const saveDepthImageSetting = useCallback(
    async ({ id, values }: SaveDepthImageSettingArgs): Promise<DepthImageSetting> => {
      setError(null);
      try {
        if (id) return await updateDepthImageSetting({ id, values }).unwrap();
        return await createDepthImageSetting(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save depth image settings.'));
        throw requestError;
      }
    },
    [createDepthImageSetting, updateDepthImageSetting]
  );

  return {
    saveDepthImageSetting,
    saving: createState.isLoading || updateState.isLoading,
    error,
  };
}
