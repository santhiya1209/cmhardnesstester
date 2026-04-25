import axios from 'axios';
import type { GenericSetting } from '@/types/genericSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getGenericSetting(): Promise<GenericSetting[]> {
  const { data } = await axios.get<GenericSetting[]>(
    `${API_BASE_URL}/api/generic-setting`
  );
  return data;
}
