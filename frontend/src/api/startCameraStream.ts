import type { IpcInvokeMap } from '@/types/ipc';

export function startCameraStream(): Promise<IpcInvokeMap['camera:start-stream']['response']> {
  return window.api.invoke('camera:start-stream');
}
