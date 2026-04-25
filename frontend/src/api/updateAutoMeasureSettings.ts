import axios from 'axios';
import type { AutoMeasureSettings, AutoMeasureSettingsPayload } from '@/types/autoMeasureSettings';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateAutoMeasureSettings(
  id: string,
  payload: AutoMeasureSettingsPayload
): Promise<AutoMeasureSettings> {
  const { data } = await axios.put<AutoMeasureSettings>(
    `${API_BASE_URL}/api/auto-measure-settings/${id}`,
    payload
  );
  return data;
}
