import axios from 'axios';
import { API_BASE_URL } from '@/utils/baseUrl';
import type { MachineApiResponse, MachineControlKey } from '@/types/machine';

export async function setMachineControlValue(
  key: MachineControlKey,
  value: string | number
): Promise<MachineApiResponse> {
  // eslint-disable-next-line no-console
  console.log('[machine-ipc] command sent setMachineControlValue', { key, value });
  const { data } = await axios.post<MachineApiResponse>(
    `${API_BASE_URL}/api/machine/set`,
    { key, value }
  );
  return data;
}
