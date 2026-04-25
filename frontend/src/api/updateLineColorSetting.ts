import axios from 'axios';
import type { LineColorSetting, LineColorSettingPayload } from '@/types/lineColorSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateLineColorSetting(
  id: string,
  payload: LineColorSettingPayload
): Promise<LineColorSetting> {
  const { data } = await axios.put<LineColorSetting>(
    `${API_BASE_URL}/api/line-color-setting/${id}`,
    payload
  );
  return data;
}
