import axios from 'axios';
import type { AutoMeasureSettings } from '@/types/autoMeasureSettings';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getAutoMeasureSettings(): Promise<AutoMeasureSettings[]> {
  const { data } = await axios.get<AutoMeasureSettings[]>(`${API_BASE_URL}/api/auto-measure-settings`);
  return data;
}
