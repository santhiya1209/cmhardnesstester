import axios from 'axios';
import type {
  DepthImageSetting,
  DepthImageSettingPayload,
} from '@/types/depthImageSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateDepthImageSetting(
  id: string,
  payload: DepthImageSettingPayload
): Promise<DepthImageSetting> {
  const { data } = await axios.put<DepthImageSetting>(
    `${API_BASE_URL}/api/depth-image-settings/${id}`,
    payload
  );
  return data;
}
