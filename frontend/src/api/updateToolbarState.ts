import axios from 'axios';
import type { ToolbarState, ToolbarStatePayload } from '@/types/toolbarState';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function updateToolbarState(
  id: string,
  payload: ToolbarStatePayload
): Promise<ToolbarState> {
  const { data } = await axios.put<ToolbarState>(
    `${API_BASE_URL}/api/toolbar-states/${id}`,
    payload
  );
  return data;
}
