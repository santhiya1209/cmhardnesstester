import axios from 'axios';
import type { OtherSetting, OtherSettingPayload } from '@/types/otherSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createOtherSetting(
  payload: OtherSettingPayload
): Promise<OtherSetting> {
  const { data } = await axios.post<OtherSetting>(
    `${API_BASE_URL}/api/other-setting`,
    payload
  );
  return data;
}
