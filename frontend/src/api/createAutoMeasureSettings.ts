import axios from 'axios';
import type { AutoMeasureSettings, AutoMeasureSettingsPayload } from '@/types/autoMeasureSettings';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createAutoMeasureSettings(
  payload: AutoMeasureSettingsPayload
): Promise<AutoMeasureSettings> {
  const { data } = await axios.post<AutoMeasureSettings>(`${API_BASE_URL}/api/auto-measure-settings`, payload);
  return data;
}
