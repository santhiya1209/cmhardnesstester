import type {
  ConnectMachineRequest,
  MachineApiResponse,
  MachineControlKey,
  TurretDirection,
} from '@/types/machine';
import type { MachineSettings, MachineSettingsPayload } from '@/types/machineSettings';
import { apiClient } from '../_client';

export const connectMachine = (payload: ConnectMachineRequest) =>
  apiClient.post<MachineApiResponse>('/api/machine/connect', payload);

export const disconnectMachine = () =>
  apiClient.post<MachineApiResponse>('/api/machine/disconnect');

export const confirmObjectivePhysical = () =>
  apiClient.post<MachineApiResponse>('/api/machine/objective/confirm-physical');

export const getMachineState = (): Promise<MachineApiResponse> =>
  window.machineControl!.getState();

export const setMachineControlValue = async (
  key: MachineControlKey,
  value: string | number
): Promise<MachineApiResponse> => {
  const reply = await window.machineControl!.setValue(key, value);
  if (!reply.ok) throw new Error(reply.message ?? reply.error ?? `Machine ${key} command failed`);
  return reply;
};

export const sendTurret = async (direction: TurretDirection): Promise<MachineApiResponse> => {
  const reply = await window.machineControl!.moveTurret(direction);
  if (!reply.ok) throw new Error(reply.message ?? reply.error ?? `Failed to move turret ${direction}`);
  return reply;
};

export const startIndent = async (): Promise<MachineApiResponse> => {
  const reply = await window.machineControl!.startIndent();
  if (!reply.ok) throw new Error(reply.message ?? reply.error ?? 'Machine impress command failed');
  return reply;
};

export const applyObjectiveBrightness = async (
  objective: string
): Promise<MachineApiResponse> => {
  const reply = await window.machineControl!.applyObjectiveBrightness(objective);
  if (!reply.ok) throw new Error(reply.message ?? reply.error ?? `Failed to apply brightness for ${objective}`);
  return reply;
};

export const getMachineSettings = () =>
  apiClient.get<MachineSettings[]>('/api/machine-settings');

export const createMachineSettings = (payload: MachineSettingsPayload) =>
  apiClient.post<MachineSettings>('/api/machine-settings', payload);

export const updateMachineSettings = (id: string, payload: MachineSettingsPayload) =>
  apiClient.put<MachineSettings>(`/api/machine-settings/${id}`, payload);
