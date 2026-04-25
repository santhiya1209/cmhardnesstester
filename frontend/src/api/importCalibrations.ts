import axios from 'axios';
import type { Calibration, CalibrationImportPayload } from '@/types/calibration';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function importCalibrations(
  payload: CalibrationImportPayload
): Promise<Calibration[]> {
  const { data } = await axios.post<Calibration[]>(
    `${API_BASE_URL}/api/calibrations/import`,
    payload
  );
  return data;
}
