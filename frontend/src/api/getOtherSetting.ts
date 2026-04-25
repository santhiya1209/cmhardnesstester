import axios from 'axios';
import type { OtherSetting } from '@/types/otherSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getOtherSetting(): Promise<OtherSetting[]> {
  const { data } = await axios.get<OtherSetting[]>(`${API_BASE_URL}/api/other-setting`);
  return data;
}
