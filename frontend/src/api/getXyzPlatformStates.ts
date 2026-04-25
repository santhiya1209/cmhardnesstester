import axios from 'axios';
import type { XYZPlatformState } from '@/types/xyzPlatformState';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getXyzPlatformStates(): Promise<XYZPlatformState[]> {
  const { data } = await axios.get<XYZPlatformState[]>(`${API_BASE_URL}/api/xyz-platform-states`);
  return data;
}
