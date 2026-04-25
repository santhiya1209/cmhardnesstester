import axios from 'axios';
import type { PatternProgram, PatternProgramPayload } from '@/types/patternProgram';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updatePatternProgram(
  id: string,
  payload: PatternProgramPayload
): Promise<PatternProgram> {
  const { data } = await axios.put<PatternProgram>(
    `${API_BASE_URL}/api/pattern-programs/${id}`,
    payload
  );
  return data;
}
