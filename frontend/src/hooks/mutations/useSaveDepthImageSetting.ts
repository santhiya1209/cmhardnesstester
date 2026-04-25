import { useCallback, useState } from 'react';
import { createDepthImageSetting } from '@/api/createDepthImageSetting';
import { updateDepthImageSetting } from '@/api/updateDepthImageSetting';
import type {
  DepthImageSetting,
  DepthImageSettingPayload,
} from '@/types/depthImageSetting';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type SaveDepthImageSettingArgs = {
  id?: string;
  values: DepthImageSettingPayload;
};

export function useSaveDepthImageSetting() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveDepthImageSetting = useCallback(
    async ({ id, values }: SaveDepthImageSettingArgs): Promise<DepthImageSetting> => {
      setSaving(true);
      setError(null);

      try {
        if (id) {
          return await updateDepthImageSetting(id, values);
        }

        return await createDepthImageSetting(values);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save depth image settings.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    saveDepthImageSetting,
    saving,
    error,
  };
}
