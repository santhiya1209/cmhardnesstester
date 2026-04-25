import axios from 'axios';
import type { Measurement } from '@/types/measurement';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getMeasurements(): Promise<Measurement[]> {
  const { data } = await axios.get<Measurement[]>(`${API_BASE_URL}/api/measurements`);
  return data;
}
