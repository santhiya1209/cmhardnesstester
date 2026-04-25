import axios from 'axios';
import type { DepthImageSetting } from '@/types/depthImageSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getDepthImageSettings(): Promise<DepthImageSetting[]> {
  const { data } = await axios.get<DepthImageSetting[]>(
    `${API_BASE_URL}/api/depth-image-settings`
  );
  return data;
}
