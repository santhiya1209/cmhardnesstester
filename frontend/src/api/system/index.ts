import type {
  VickersAutoMeasureParameters,
  VickersAutoMeasureResult,
} from '@/types/autoMeasure';
import type { OpenImageResult, SaveImageRequest, SaveImageResult } from '@/types/dialog';
import type { Health } from '@/types/health';
import type { IpcInvokeMap } from '@/types/ipc';
import { apiClient } from '../_client';

// Health check (HTTP)
export const getHealth = () => apiClient.get<Health>('/api/health');

// App lifecycle (IPC)
export const exitApp = (): Promise<IpcInvokeMap['app:exit']['response']> =>
  window.api.invoke('app:exit');

// File dialogs (IPC)
export const openImageDialog = (): Promise<OpenImageResult> =>
  window.api.invoke('dialog:openImage');

export const saveImageDialog = (
  payload: SaveImageRequest = {}
): Promise<SaveImageResult> => window.api.invoke('dialog:saveImage', payload);

// Vickers auto-measurement (IPC into the camera native module)
export const measureVickersAuto = (
  parameters: VickersAutoMeasureParameters
): Promise<VickersAutoMeasureResult> =>
  window.api.invoke('camera:measure-vickers-auto', parameters);

export const measureVickersAutoPreview = (
  parameters: VickersAutoMeasureParameters
): Promise<VickersAutoMeasureResult> => measureVickersAuto(parameters);
