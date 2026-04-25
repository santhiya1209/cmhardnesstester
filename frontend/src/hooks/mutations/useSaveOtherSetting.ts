import { useCallback, useState } from 'react';
import { createOtherSetting } from '@/api/createOtherSetting';
import { updateOtherSetting } from '@/api/updateOtherSetting';
import type { OtherSetting, OtherSettingSavePayload } from '@/types/otherSetting';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useSaveOtherSetting() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveOtherSetting = useCallback(
    async ({ id, values }: OtherSettingSavePayload): Promise<OtherSetting> => {
      setSaving(true);
      setError(null);

      try {
        if (id) {
          return await updateOtherSetting(id, values);
        }
        return await createOtherSetting(values);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save other setting.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return { saveOtherSetting, saving, error };
}
