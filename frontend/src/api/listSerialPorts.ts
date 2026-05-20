import type { IpcInvokeMap } from '@/types/ipc';

export function listSerialPorts(): Promise<IpcInvokeMap['serial:list-ports']['response']> {
  return window.api.invoke('serial:list-ports');
}
