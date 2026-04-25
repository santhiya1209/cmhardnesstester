import axios from 'axios';
import type { TestRecord, TestRecordSavePayload } from '@/types/testRecord';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createTestRecord(payload: TestRecordSavePayload): Promise<TestRecord> {
  const { data } = await axios.post<TestRecord>(`${API_BASE_URL}/api/test-records`, payload);
  return data;
}
