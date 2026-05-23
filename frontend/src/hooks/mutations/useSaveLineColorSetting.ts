import { useCallback, useState } from 'react';
import { createLineColorSetting } from '@/api/settings';
import { updateLineColorSetting } from '@/api/settings';
import type {
  LineColorSetting,
  LineColorSettingPayload,
  LineColorSettingSavePayload,
} from '@/types/lineColorSetting';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useSaveLineColorSetting() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveLineColorSetting = useCallback(
    async ({ id, values }: LineColorSettingSavePayload): Promise<LineColorSetting> => {
      setSaving(true);
      setError(null);

      try {
        const payload: LineColorSettingPayload = { lineColor: values.lineColor };
        if (id) {
          return await updateLineColorSetting(id, payload);
        }
        return await createLineColorSetting(payload);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save line color setting.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return { saveLineColorSetting, saving, error };
}
