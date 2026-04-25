import axios from 'axios';
import type { CalibrationExport } from '@/types/calibration';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function exportCalibrations(): Promise<CalibrationExport> {
  const { data } = await axios.get<CalibrationExport>(`${API_BASE_URL}/api/calibrations/export`);
  return data;
}
