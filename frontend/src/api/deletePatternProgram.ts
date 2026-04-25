import axios from 'axios';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function deletePatternProgram(id: string): Promise<void> {
  await axios.delete(`${API_BASE_URL}/api/pattern-programs/${id}`);
}
