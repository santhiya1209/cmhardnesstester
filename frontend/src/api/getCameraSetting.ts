import axios from 'axios';
import type { CameraSetting } from '@/types/cameraSetting';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getCameraSetting(): Promise<CameraSetting[]> {
  const { data } = await axios.get<CameraSetting[]>(
    `${API_BASE_URL}/api/camera-setting`
  );
  return data;
}
