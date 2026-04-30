import type { IpcInvokeMap } from '@/types/ipc';

export function getMicrometerState(): Promise<IpcInvokeMap['micrometer:get-state']['response']> {
  return window.api.invoke('micrometer:get-state');
}
