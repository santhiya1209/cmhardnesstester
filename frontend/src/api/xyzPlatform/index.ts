import type {
  XYZPlatformState,
  XYZPlatformStatePayload,
} from '@/types/xyzPlatformState';
import { apiClient } from '../_client';

export const getXyzPlatformStates = () =>
  apiClient.get<XYZPlatformState[]>('/api/xyz-platform-states');

export const createXyzPlatformState = (payload: XYZPlatformStatePayload) =>
  apiClient.post<XYZPlatformState>('/api/xyz-platform-states', payload);

export const updateXyzPlatformState = (id: string, payload: XYZPlatformStatePayload) =>
  apiClient.put<XYZPlatformState>(`/api/xyz-platform-states/${id}`, payload);
