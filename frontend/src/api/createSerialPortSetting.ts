import axios from 'axios';
import type {
  SerialPortSetting,
  SerialPortSettingPayload,
} from '@/types/serialPortSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createSerialPortSetting(
  payload: SerialPortSettingPayload
): Promise<SerialPortSetting> {
  const { data } = await axios.post<SerialPortSetting>(
    `${API_BASE_URL}/api/serial-port-setting`,
    payload
  );
  return data;
}
