import axios from 'axios';
import type { MicrometerConfig, MicrometerConfigPayload } from '@/types/micrometerConfig';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateMicrometerConfig(
  id: string,
  payload: MicrometerConfigPayload
): Promise<MicrometerConfig> {
  const { data } = await axios.put<MicrometerConfig>(
    `${API_BASE_URL}/api/micrometer-config/${id}`,
    payload
  );
  return data;
}
