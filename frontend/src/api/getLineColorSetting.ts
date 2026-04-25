import axios from 'axios';
import type { LineColorSetting } from '@/types/lineColorSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getLineColorSetting(): Promise<LineColorSetting[]> {
  const { data } = await axios.get<LineColorSetting[]>(
    `${API_BASE_URL}/api/line-color-setting`
  );
  return data;
}
