import axios from 'axios';
import { API_BASE_URL } from '@/utils/baseUrl';
import type { ConnectMachineRequest, MachineApiResponse } from '@/types/machine';

export async function connectMachine(payload: ConnectMachineRequest): Promise<MachineApiResponse> {
  // eslint-disable-next-line no-console
  console.log('[machine-ipc] command sent connectMachine', payload);
  const { data } = await axios.post<MachineApiResponse>(
    `${API_BASE_URL}/api/machine/connect`,
    payload
  );
  return data;
}
