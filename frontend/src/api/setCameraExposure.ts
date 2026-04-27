import type { IpcInvokeMap } from '@/types/ipc';

export function setCameraExposure(valueUs: number): Promise<IpcInvokeMap['camera:set-exposure']['response']> {
  return window.api.invoke('camera:set-exposure', { valueUs });
}
