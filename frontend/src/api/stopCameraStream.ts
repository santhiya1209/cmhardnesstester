import type { IpcInvokeMap } from '@/types/ipc';

export function stopCameraStream(): Promise<IpcInvokeMap['camera:stop-stream']['response']> {
  return window.api.invoke('camera:stop-stream');
}
