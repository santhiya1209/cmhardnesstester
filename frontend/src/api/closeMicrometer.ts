import type { IpcInvokeMap } from '@/types/ipc';

export function closeMicrometer(): Promise<IpcInvokeMap['micrometer:close']['response']> {
  return window.api.invoke('micrometer:close');
}
