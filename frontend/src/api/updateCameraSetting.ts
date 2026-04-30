import axios from 'axios';
import type { CameraSetting, CameraSettingPayload } from '@/types/cameraSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateCameraSetting(
  id: string,
  payload: CameraSettingPayload
): Promise<CameraSetting> {
  const { data } = await axios.put<CameraSetting>(
    `${API_BASE_URL}/api/camera-setting/${id}`,
    payload
  );
  return data;
}
