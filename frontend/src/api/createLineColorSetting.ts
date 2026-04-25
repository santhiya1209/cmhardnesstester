import axios from 'axios';
import type { LineColorSetting, LineColorSettingPayload } from '@/types/lineColorSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createLineColorSetting(
  payload: LineColorSettingPayload
): Promise<LineColorSetting> {
  const { data } = await axios.post<LineColorSetting>(
    `${API_BASE_URL}/api/line-color-setting`,
    payload
  );
  return data;
}
