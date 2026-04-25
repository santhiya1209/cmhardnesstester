import axios from 'axios';
import type { TestRecord } from '@/types/testRecord';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getTestRecords(): Promise<TestRecord[]> {
  const { data } = await axios.get<TestRecord[]>(`${API_BASE_URL}/api/test-records`);
  return data;
}
