import axios from 'axios';
import type { GenericSetting, GenericSettingPayload } from '@/types/genericSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createGenericSetting(
  payload: GenericSettingPayload
): Promise<GenericSetting> {
  const { data } = await axios.post<GenericSetting>(
    `${API_BASE_URL}/api/generic-setting`,
    payload
  );
  return data;
}
