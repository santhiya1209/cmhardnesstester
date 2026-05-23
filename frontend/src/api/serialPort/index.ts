import type { IpcInvokeMap } from '@/types/ipc';
import type {
  SerialPortSetting,
  SerialPortSettingPayload,
} from '@/types/serialPortSetting';
import { apiClient } from '../_client';

// IPC: query available serial ports from the OS.
export const listSerialPorts = (): Promise<IpcInvokeMap['serial:list-ports']['response']> =>
  window.api.invoke('serial:list-ports');

// Serial-port-setting CRUD (HTTP)
export const getSerialPortSetting = () =>
  apiClient.get<SerialPortSetting[]>('/api/serial-port-setting');

export const createSerialPortSetting = (payload: SerialPortSettingPayload) =>
  apiClient.post<SerialPortSetting>('/api/serial-port-setting', payload);

export const updateSerialPortSetting = (id: string, payload: SerialPortSettingPayload) =>
  apiClient.put<SerialPortSetting>(`/api/serial-port-setting/${id}`, payload);
