import axios from 'axios';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getCalibrationSettings(): Promise<CalibrationSettings[]> {
  const { data } = await axios.get<CalibrationSettings[]>(`${API_BASE_URL}/api/calibration-settings`);
  return data;
}
