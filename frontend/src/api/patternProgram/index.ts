import type { PatternProgram, PatternProgramPayload } from '@/types/patternProgram';
import { apiClient } from '../_client';

export const getPatternPrograms = () =>
  apiClient.get<PatternProgram[]>('/api/pattern-programs');

export const createPatternProgram = (payload: PatternProgramPayload) =>
  apiClient.post<PatternProgram>('/api/pattern-programs', payload);

export const updatePatternProgram = (id: string, payload: PatternProgramPayload) =>
  apiClient.put<PatternProgram>(`/api/pattern-programs/${id}`, payload);

export const deletePatternProgram = (id: string) =>
  apiClient.delete(`/api/pattern-programs/${id}`);
