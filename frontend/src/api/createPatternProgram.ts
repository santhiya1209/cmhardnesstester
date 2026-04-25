import axios from 'axios';
import type { PatternProgram, PatternProgramPayload } from '@/types/patternProgram';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createPatternProgram(
  payload: PatternProgramPayload
): Promise<PatternProgram> {
  const { data } = await axios.post<PatternProgram>(`${API_BASE_URL}/api/pattern-programs`, payload);
  return data;
}
