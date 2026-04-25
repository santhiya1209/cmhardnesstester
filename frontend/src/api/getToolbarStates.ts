import axios from 'axios';
import type { ToolbarState } from '@/types/toolbarState';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getToolbarStates(): Promise<ToolbarState[]> {
  const { data } = await axios.get<ToolbarState[]>(`${API_BASE_URL}/api/toolbar-states`);
  return data;
}
