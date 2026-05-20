import type { IpcInvokeMap } from '@/types/ipc';

export function openMicrometer(
  port: string
): Promise<IpcInvokeMap['micrometer:open']['response']> {
  return window.api.invoke('micrometer:open', { port });
}
