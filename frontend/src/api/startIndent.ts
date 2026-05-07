import axios from 'axios';
import { API_BASE_URL } from '@/utils/baseUrl';
import type { MachineApiResponse } from '@/types/machine';

export async function startIndent(): Promise<MachineApiResponse> {
  // eslint-disable-next-line no-console
  console.log('[machine-ipc] command sent startIndent');
  if (window.machineControl) {
    const reply = await window.machineControl.startIndent();
    if (!reply.ok) {
      throw new Error(reply.message ?? reply.error ?? 'Machine impress command failed');
    }
    return reply;
  }
  const { data } = await axios.post<MachineApiResponse>(
    `${API_BASE_URL}/api/machine/indent`
  );
  return data;
}
