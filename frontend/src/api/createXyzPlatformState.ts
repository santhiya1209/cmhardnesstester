import axios from 'axios';
import type { XYZPlatformState, XYZPlatformStatePayload } from '@/types/xyzPlatformState';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createXyzPlatformState(
  payload: XYZPlatformStatePayload
): Promise<XYZPlatformState> {
  const { data } = await axios.post<XYZPlatformState>(
    `${API_BASE_URL}/api/xyz-platform-states`,
    payload
  );
  return data;
}
