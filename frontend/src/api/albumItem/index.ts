import type { AlbumItem, AlbumItemPayload } from '@/types/albumItem';
import { apiClient } from '../_client';

export const getAlbumItems = () => apiClient.get<AlbumItem[]>('/api/album-items');

export const createAlbumItem = (payload: AlbumItemPayload) =>
  apiClient.post<AlbumItem>('/api/album-items', payload);

export const deleteAlbumItem = (id: string) =>
  apiClient.delete(`/api/album-items/${id}`);
