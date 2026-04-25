import axios from 'axios';
import type { OtherSetting, OtherSettingPayload } from '@/types/otherSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateOtherSetting(
  id: string,
  payload: OtherSettingPayload
): Promise<OtherSetting> {
  const { data } = await axios.put<OtherSetting>(
    `${API_BASE_URL}/api/other-setting/${id}`,
    payload
  );
  return data;
}
