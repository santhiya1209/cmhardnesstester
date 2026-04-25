import axios from 'axios';
import type { AlbumItem } from '@/types/albumItem';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getAlbumItems(): Promise<AlbumItem[]> {
  const { data } = await axios.get<AlbumItem[]>(`${API_BASE_URL}/api/album-items`);
  return data;
}
