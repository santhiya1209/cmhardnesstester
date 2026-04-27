import type { IpcInvokeMap } from '@/types/ipc';

export function openCamera(index = 0): Promise<IpcInvokeMap['camera:open']['response']> {
  return window.api.invoke('camera:open', { index });
}
