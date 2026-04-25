import axios from 'axios';
import type { AlbumItem, AlbumItemPayload } from '@/types/albumItem';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function createAlbumItem(payload: AlbumItemPayload): Promise<AlbumItem> {
  const { data } = await axios.post<AlbumItem>(`${API_BASE_URL}/api/album-items`, payload);
  return data;
}
