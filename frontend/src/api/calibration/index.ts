import type {
  Calibration,
  CalibrationSavePayload,
  CalibrationExport,
  CalibrationImportPayload,
} from '@/types/calibration';
import type {
  CalibrationSettings,
  CalibrationSettingsSavePayload,
} from '@/types/calibrationSettings';
import { apiClient } from '../_client';

export const getCalibrations = () => apiClient.get<Calibration[]>('/api/calibrations');

export const createCalibration = (payload: CalibrationSavePayload) =>
  apiClient.post<Calibration>('/api/calibrations', payload);

export const deleteCalibration = (id: string) =>
  apiClient.delete(`/api/calibrations/${id}`);

export const clearCalibrations = () => apiClient.delete('/api/calibrations/clear');

export const exportCalibrations = () =>
  apiClient.get<CalibrationExport>('/api/calibrations/export');

export const importCalibrations = (payload: CalibrationImportPayload) =>
  apiClient.post<Calibration[]>('/api/calibrations/import', payload);

export const getCalibrationSettings = () =>
  apiClient.get<CalibrationSettings[]>('/api/calibration-settings');

export const createCalibrationSettings = (payload: CalibrationSettingsSavePayload) =>
  apiClient.post<CalibrationSettings>('/api/calibration-settings', payload);

export const updateCalibrationSettings = (
  id: string,
  payload: CalibrationSettingsSavePayload
) => apiClient.put<CalibrationSettings>(`/api/calibration-settings/${id}`, payload);
