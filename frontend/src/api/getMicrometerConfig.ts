import axios from 'axios';
import type { MicrometerConfig } from '@/types/micrometerConfig';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getMicrometerConfig(): Promise<MicrometerConfig[]> {
  const { data } = await axios.get<MicrometerConfig[]>(`${API_BASE_URL}/api/micrometer-config`);
  return data;
}
