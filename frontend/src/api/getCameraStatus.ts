import type { IpcInvokeMap } from '@/types/ipc';

export function getCameraStatus(): Promise<IpcInvokeMap['camera:get-status']['response']> {
  return window.api.invoke('camera:get-status');
}
