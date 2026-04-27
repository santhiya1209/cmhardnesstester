import type { IpcInvokeMap } from '@/types/ipc';

export function setCameraTriggerMode(value: boolean): Promise<IpcInvokeMap['camera:set-trigger-mode']['response']> {
  return window.api.invoke('camera:set-trigger-mode', { value });
}
