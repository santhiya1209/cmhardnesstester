import axios from 'axios';
import type { Calibration } from '@/types/calibration';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getCalibrations(): Promise<Calibration[]> {
  const { data } = await axios.get<Calibration[]>(`${API_BASE_URL}/api/calibrations`);
  return data;
}
