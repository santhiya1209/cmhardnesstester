import axios from 'axios';
import type { CameraSetting, CameraSettingPayload } from '@/types/cameraSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createCameraSetting(
  payload: CameraSettingPayload
): Promise<CameraSetting> {
  const { data } = await axios.post<CameraSetting>(
    `${API_BASE_URL}/api/camera-setting`,
    payload
  );
  return data;
}
