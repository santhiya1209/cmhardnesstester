import axios from 'axios';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function restoreFactorySettings(): Promise<void> {
  await axios.post(`${API_BASE_URL}/api/factory-reset`);
}
