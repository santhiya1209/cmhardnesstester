import axios from 'axios';
import type { MicrometerConfig, MicrometerConfigPayload } from '@/types/micrometerConfig';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createMicrometerConfig(
  payload: MicrometerConfigPayload
): Promise<MicrometerConfig> {
  const { data } = await axios.post<MicrometerConfig>(
    `${API_BASE_URL}/api/micrometer-config`,
    payload
  );
  return data;
}
