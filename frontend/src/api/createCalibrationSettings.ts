import axios from 'axios';
import type {
  CalibrationSettings,
  CalibrationSettingsSavePayload,
} from '@/types/calibrationSettings';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createCalibrationSettings(
  payload: CalibrationSettingsSavePayload
): Promise<CalibrationSettings> {
  const { data } = await axios.post<CalibrationSettings>(
    `${API_BASE_URL}/api/calibration-settings`,
    payload
  );
  return data;
}
