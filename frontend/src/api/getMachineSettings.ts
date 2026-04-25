import axios from 'axios';
import type { MachineSettings } from '@/types/machineSettings';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getMachineSettings(): Promise<MachineSettings[]> {
  const { data } = await axios.get<MachineSettings[]>(`${API_BASE_URL}/api/machine-settings`);
  return data;
}
