import axios from 'axios';
import type { GenericSetting, GenericSettingPayload } from '@/types/genericSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateGenericSetting(
  id: string,
  payload: GenericSettingPayload
): Promise<GenericSetting> {
  const { data } = await axios.put<GenericSetting>(
    `${API_BASE_URL}/api/generic-setting/${id}`,
    payload
  );
  return data;
}
