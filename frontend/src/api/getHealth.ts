import axios from 'axios';
import type { Health } from '@/types/health';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getHealth(): Promise<Health> {
  const { data } = await axios.get<Health>(`${API_BASE_URL}/api/health`);
  return data;
}

