import { useCallback, useState } from 'react';
import { createSerialPortSetting } from '@/api/serialPort';
import { updateSerialPortSetting } from '@/api/serialPort';
import type {
  SerialPortSetting,
  SerialPortSettingSavePayload,
} from '@/types/serialPortSetting';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useSaveSerialPortSetting() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveSerialPortSetting = useCallback(
    async ({ id, values }: SerialPortSettingSavePayload): Promise<SerialPortSetting> => {
      setSaving(true);
      setError(null);

      try {
        if (id) {
          return await updateSerialPortSetting(id, values);
        }
        return await createSerialPortSetting(values);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save serial port setting.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return { saveSerialPortSetting, saving, error };
}
