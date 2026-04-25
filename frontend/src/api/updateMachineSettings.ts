import axios from 'axios';
import type { MachineSettings, MachineSettingsPayload } from '@/types/machineSettings';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateMachineSettings(
  id: string,
  payload: MachineSettingsPayload
): Promise<MachineSettings> {
  const { data } = await axios.put<MachineSettings>(`${API_BASE_URL}/api/machine-settings/${id}`, payload);
  return data;
}
