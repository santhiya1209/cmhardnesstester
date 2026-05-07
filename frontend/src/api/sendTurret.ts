import axios from 'axios';
import { API_BASE_URL } from '@/utils/baseUrl';
import type { MachineApiResponse, TurretDirection } from '@/types/machine';

export async function sendTurret(direction: TurretDirection): Promise<MachineApiResponse> {
  // eslint-disable-next-line no-console
  console.log('[machine-ipc] command sent sendTurret', { direction });
  if (window.machineControl) {
    const reply = await window.machineControl.moveTurret(direction);
    if (!reply.ok) {
      throw new Error(reply.message ?? reply.error ?? `Failed to move turret ${direction}`);
    }
    return reply;
  }
  const { data } = await axios.post<MachineApiResponse>(
    `${API_BASE_URL}/api/machine/turret`,
    { direction }
  );
  return data;
}
