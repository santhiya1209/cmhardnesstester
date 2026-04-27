import type { IpcInvokeMap } from '@/types/ipc';

export function setCameraGain(value: number): Promise<IpcInvokeMap['camera:set-gain']['response']> {
  return window.api.invoke('camera:set-gain', { value });
}
