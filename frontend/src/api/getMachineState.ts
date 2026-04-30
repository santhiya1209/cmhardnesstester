import axios from 'axios';
import { API_BASE_URL } from '@/utils/baseUrl';
import type { MachineApiResponse } from '@/types/machine';

export async function getMachineState(): Promise<MachineApiResponse> {
  const { data } = await axios.get<MachineApiResponse>(`${API_BASE_URL}/api/machine/state`);
  return data;
}
