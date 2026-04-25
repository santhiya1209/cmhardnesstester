import axios from 'axios';
import type { Calibration, CalibrationSavePayload } from '@/types/calibration';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createCalibration(payload: CalibrationSavePayload): Promise<Calibration> {
  const { data } = await axios.post<Calibration>(`${API_BASE_URL}/api/calibrations`, payload);
  return data;
}
