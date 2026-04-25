import axios from 'axios';
import type { MachineSettings, MachineSettingsPayload } from '@/types/machineSettings';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createMachineSettings(payload: MachineSettingsPayload): Promise<MachineSettings> {
  const { data } = await axios.post<MachineSettings>(`${API_BASE_URL}/api/machine-settings`, payload);
  return data;
}
