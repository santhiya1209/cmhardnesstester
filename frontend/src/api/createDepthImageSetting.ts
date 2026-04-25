import axios from 'axios';
import type {
  DepthImageSetting,
  DepthImageSettingPayload,
} from '@/types/depthImageSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createDepthImageSetting(
  payload: DepthImageSettingPayload
): Promise<DepthImageSetting> {
  const { data } = await axios.post<DepthImageSetting>(
    `${API_BASE_URL}/api/depth-image-settings`,
    payload
  );
  return data;
}
