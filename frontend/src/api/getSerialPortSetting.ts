import axios from 'axios';
import type { SerialPortSetting } from '@/types/serialPortSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getSerialPortSetting(): Promise<SerialPortSetting[]> {
  const { data } = await axios.get<SerialPortSetting[]>(
    `${API_BASE_URL}/api/serial-port-setting`
  );
  return data;
}
