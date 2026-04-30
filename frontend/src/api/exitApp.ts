import type { IpcInvokeMap } from '@/types/ipc';

export function exitApp(): Promise<IpcInvokeMap['app:exit']['response']> {
  return window.api.invoke('app:exit');
}
