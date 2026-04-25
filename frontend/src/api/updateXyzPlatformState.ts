import axios from 'axios';
import type { XYZPlatformState, XYZPlatformStatePayload } from '@/types/xyzPlatformState';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateXyzPlatformState(
  id: string,
  payload: XYZPlatformStatePayload
): Promise<XYZPlatformState> {
  const { data } = await axios.put<XYZPlatformState>(
    `${API_BASE_URL}/api/xyz-platform-states/${id}`,
    payload
  );
  return data;
}
