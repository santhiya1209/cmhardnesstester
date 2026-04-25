import axios from 'axios';
import type {
  SerialPortSetting,
  SerialPortSettingPayload,
} from '@/types/serialPortSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateSerialPortSetting(
  id: string,
  payload: SerialPortSettingPayload
): Promise<SerialPortSetting> {
  const { data } = await axios.put<SerialPortSetting>(
    `${API_BASE_URL}/api/serial-port-setting/${id}`,
    payload
  );
  return data;
}
