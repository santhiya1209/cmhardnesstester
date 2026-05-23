import { useCallback, useState } from 'react';
import { createGenericSetting } from '@/api/settings';
import { updateGenericSetting } from '@/api/settings';
import type {
  GenericSetting,
  GenericSettingSavePayload,
} from '@/types/genericSetting';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useSaveGenericSetting() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveGenericSetting = useCallback(
    async ({ id, values }: GenericSettingSavePayload): Promise<GenericSetting> => {
      setSaving(true);
      setError(null);

      try {
        if (id) {
          return await updateGenericSetting(id, values);
        }
        return await createGenericSetting(values);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save generic setting.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return { saveGenericSetting, saving, error };
}
