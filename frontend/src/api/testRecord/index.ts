import type { TestRecord, TestRecordSavePayload } from '@/types/testRecord';
import { apiClient } from '../_client';

export const getTestRecords = () => apiClient.get<TestRecord[]>('/api/test-records');

export const createTestRecord = (payload: TestRecordSavePayload) =>
  apiClient.post<TestRecord>('/api/test-records', payload);

export const updateTestRecord = (id: string, payload: TestRecordSavePayload) =>
  apiClient.put<TestRecord>(`/api/test-records/${id}`, payload);

export const deleteTestRecord = (id: string) =>
  apiClient.delete(`/api/test-records/${id}`);
