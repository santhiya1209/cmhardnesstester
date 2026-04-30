import type { IpcInvokeMap } from '@/types/ipc';

export function getLatestMicrometerReading(): Promise<
  IpcInvokeMap['micrometer:get-latest-reading']['response']
> {
  return window.api.invoke('micrometer:get-latest-reading');
}
