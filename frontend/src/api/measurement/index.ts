import type { Measurement, MeasurementSavePayload } from '@/types/measurement';
import { apiClient } from '../_client';

export const getMeasurements = () => apiClient.get<Measurement[]>('/api/measurements');

export const createMeasurement = (payload: MeasurementSavePayload) =>
  apiClient.post<Measurement>('/api/measurements', payload);

export const updateMeasurement = (id: string, payload: MeasurementSavePayload) =>
  apiClient.put<Measurement>(`/api/measurements/${id}`, payload);

export const deleteMeasurement = (id: string) =>
  apiClient.delete(`/api/measurements/${id}`);
