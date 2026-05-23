import type { ToolbarState, ToolbarStatePayload } from '@/types/toolbarState';
import { apiClient } from '../_client';

export const getToolbarStates = () => apiClient.get<ToolbarState[]>('/api/toolbar-states');

export const createToolbarState = (payload: ToolbarStatePayload) =>
  apiClient.post<ToolbarState>('/api/toolbar-states', payload);

export const updateToolbarState = (id: string, payload: ToolbarStatePayload) =>
  apiClient.put<ToolbarState>(`/api/toolbar-states/${id}`, payload);
