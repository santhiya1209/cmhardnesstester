import type {
  ConnectMachineRequest,
  MachineApiResponse,
  MachineControlKey,
  TurretDirection,
} from '@/types/machine';
import type { MachineSettings, MachineSettingsPayload } from '@/types/machineSettings';
import { apiClient } from '../_client';

// Machine HTTP endpoints (CRUD + actions). Action endpoints (connect / disconnect /
// confirmObjectivePhysical / setMachineControlValue / sendTurret / startIndent) are
// HTTP POSTs that mutate device state — they ride on the same shared client.
//
// `setMachineControlValue`, `sendTurret`, `startIndent`, and `getMachineState` may
// also flow over the `window.machineControl` IPC bridge when the renderer is
// running inside Electron. The bridge is preferred for lower latency; the HTTP
// path is the dev / web fallback.
//
// DEBUG (transport isolation): HTTP fallbacks for the four dual-path functions
// are currently commented out so we can verify the IPC path in isolation. If
// window.machineControl is missing, these throw instead of silently routing
// through HTTP — that way the failure is loud rather than masked. Revert this
// block (uncomment the `apiClient.*` lines + remove the throws) to restore the
// dual-transport behavior once IPC is proven.

export const connectMachine = (payload: ConnectMachineRequest) => {
  return apiClient.post<MachineApiResponse>('/api/machine/connect', payload);
};

export const disconnectMachine = () => {
  return apiClient.post<MachineApiResponse>('/api/machine/disconnect');
};

export const confirmObjectivePhysical = () => {
  return apiClient.post<MachineApiResponse>('/api/machine/objective/confirm-physical');
};

export const getMachineState = async (): Promise<MachineApiResponse> => {
  if (window.machineControl) {
    return window.machineControl.getState();
  }
  throw new Error('[machine-api] IPC bridge (window.machineControl) not available — HTTP fallback disabled for debugging');
  // return apiClient.get<MachineApiResponse>('/api/machine/state');
};

export const setMachineControlValue = async (
  key: MachineControlKey,
  value: string | number
): Promise<MachineApiResponse> => {
  if (window.machineControl) {
    const reply = await window.machineControl.setValue(key, value);
    if (!reply.ok) {
      throw new Error(reply.message ?? reply.error ?? `Machine ${key} command failed`);
    }
    return reply;
  }
  throw new Error(`[machine-api] IPC bridge not available — HTTP fallback disabled (set ${key}=${value})`);
  // return apiClient.post<MachineApiResponse>('/api/machine/set', { key, value });
};

export const sendTurret = async (direction: TurretDirection): Promise<MachineApiResponse> => {
  if (window.machineControl) {
    const reply = await window.machineControl.moveTurret(direction);
    if (!reply.ok) {
      throw new Error(reply.message ?? reply.error ?? `Failed to move turret ${direction}`);
    }
    return reply;
  }
  throw new Error(`[machine-api] IPC bridge not available — HTTP fallback disabled (turret ${direction})`);
  // return apiClient.post<MachineApiResponse>('/api/machine/turret', { direction });
};

export const startIndent = async (): Promise<MachineApiResponse> => {
  if (window.machineControl) {
    const reply = await window.machineControl.startIndent();
    if (!reply.ok) {
      throw new Error(reply.message ?? reply.error ?? 'Machine impress command failed');
    }
    return reply;
  }
  throw new Error('[machine-api] IPC bridge not available — HTTP fallback disabled (startIndent)');
  // return apiClient.post<MachineApiResponse>('/api/machine/indent');
};

// Machine settings CRUD
export const getMachineSettings = () =>
  apiClient.get<MachineSettings[]>('/api/machine-settings');

export const createMachineSettings = (payload: MachineSettingsPayload) =>
  apiClient.post<MachineSettings>('/api/machine-settings', payload);

export const updateMachineSettings = (id: string, payload: MachineSettingsPayload) =>
  apiClient.put<MachineSettings>(`/api/machine-settings/${id}`, payload);
