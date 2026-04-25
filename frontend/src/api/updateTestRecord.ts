import axios from 'axios';
import type { TestRecord, TestRecordSavePayload } from '@/types/testRecord';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateTestRecord(id: string, payload: TestRecordSavePayload): Promise<TestRecord> {
  const { data } = await axios.put<TestRecord>(`${API_BASE_URL}/api/test-records/${id}`, payload);
  return data;
}
