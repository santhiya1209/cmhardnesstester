import type { IpcInvokeMap } from '@/types/ipc';
import type { MicrometerConfig, MicrometerConfigPayload } from '@/types/micrometerConfig';
import { apiClient } from '../_client';

// IPC bridge to the micrometer service (renderer ↔ main).
export const openMicrometer = (
  port: string
): Promise<IpcInvokeMap['micrometer:open']['response']> =>
  window.api.invoke('micrometer:open', { port });

export const closeMicrometer = (): Promise<IpcInvokeMap['micrometer:close']['response']> =>
  window.api.invoke('micrometer:close');

export const getMicrometerState = (): Promise<IpcInvokeMap['micrometer:get-state']['response']> =>
  window.api.invoke('micrometer:get-state');

export const getLatestMicrometerReading = (): Promise<
  IpcInvokeMap['micrometer:get-latest-reading']['response']
> => window.api.invoke('micrometer:get-latest-reading');

// Micrometer-config CRUD (HTTP)
export const getMicrometerConfig = () =>
  apiClient.get<MicrometerConfig[]>('/api/micrometer-config');

export const createMicrometerConfig = (payload: MicrometerConfigPayload) =>
  apiClient.post<MicrometerConfig>('/api/micrometer-config', payload);

export const updateMicrometerConfig = (id: string, payload: MicrometerConfigPayload) =>
  apiClient.put<MicrometerConfig>(`/api/micrometer-config/${id}`, payload);
