import { useCallback, useState } from 'react';
import {
  useCreateSerialPortSettingMutation,
  useUpdateSerialPortSettingMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { SerialPortSetting, SerialPortSettingSavePayload } from '@/types/serialPortSetting';

export function useSaveSerialPortSetting() {
  const [createSerialPortSetting, createState] = useCreateSerialPortSettingMutation();
  const [updateSerialPortSetting, updateState] = useUpdateSerialPortSettingMutation();
  const [error, setError] = useState<string | null>(null);

  const saveSerialPortSetting = useCallback(
    async ({ id, values }: SerialPortSettingSavePayload): Promise<SerialPortSetting> => {
      setError(null);
      try {
        if (id) return await updateSerialPortSetting({ id, values }).unwrap();
        return await createSerialPortSetting(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save serial port setting.'));
        throw requestError;
      }
    },
    [createSerialPortSetting, updateSerialPortSetting]
  );

  return { saveSerialPortSetting, saving: createState.isLoading || updateState.isLoading, error };
}
