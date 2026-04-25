import axios from 'axios';
import type { PatternProgram } from '@/types/patternProgram';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getPatternPrograms(): Promise<PatternProgram[]> {
  const { data } = await axios.get<PatternProgram[]>(`${API_BASE_URL}/api/pattern-programs`);
  return data;
}
