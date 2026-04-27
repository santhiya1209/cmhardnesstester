import type { IpcInvokeMap } from '@/types/ipc';

export function closeCamera(): Promise<IpcInvokeMap['camera:close']['response']> {
  return window.api.invoke('camera:close');
}
