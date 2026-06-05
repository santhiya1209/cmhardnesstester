import { useCallback, useState } from 'react';
import {
  useCreateLineColorSettingMutation,
  useUpdateLineColorSettingMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type {
  LineColorSetting,
  LineColorSettingPayload,
  LineColorSettingSavePayload,
} from '@/types/lineColorSetting';

export function useSaveLineColorSetting() {
  const [createLineColorSetting, createState] = useCreateLineColorSettingMutation();
  const [updateLineColorSetting, updateState] = useUpdateLineColorSettingMutation();
  const [error, setError] = useState<string | null>(null);

  const saveLineColorSetting = useCallback(
    async ({ id, values }: LineColorSettingSavePayload): Promise<LineColorSetting> => {
      setError(null);
      const payload: LineColorSettingPayload = { lineColor: values.lineColor };
      try {
        if (id) return await updateLineColorSetting({ id, values: payload }).unwrap();
        return await createLineColorSetting(payload).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save line color setting.'));
        throw requestError;
      }
    },
    [createLineColorSetting, updateLineColorSetting]
  );

  return { saveLineColorSetting, saving: createState.isLoading || updateState.isLoading, error };
}
