import axios from 'axios';
import type { ToolbarState, ToolbarStatePayload } from '@/types/toolbarState';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createToolbarState(
  payload: ToolbarStatePayload
): Promise<ToolbarState> {
  const { data } = await axios.post<ToolbarState>(
    `${API_BASE_URL}/api/toolbar-states`,
    payload
  );
  return data;
}
