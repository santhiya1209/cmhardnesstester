import axios from 'axios';
import type {
  CalibrationSettings,
  CalibrationSettingsSavePayload,
} from '@/types/calibrationSettings';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateCalibrationSettings(
  id: string,
  payload: CalibrationSettingsSavePayload
): Promise<CalibrationSettings> {
  const { data } = await axios.put<CalibrationSettings>(
    `${API_BASE_URL}/api/calibration-settings/${id}`,
    payload
  );
  return data;
}
