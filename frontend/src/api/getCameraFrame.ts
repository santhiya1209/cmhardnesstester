import type { IpcInvokeMap } from '@/types/ipc';

export function getCameraFrame(timeoutMs = 4000): Promise<IpcInvokeMap['camera:get-frame']['response']> {
  return window.api.invoke('camera:get-frame', { timeoutMs });
}
