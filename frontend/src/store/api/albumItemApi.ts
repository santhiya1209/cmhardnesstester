import { baseApi } from './baseApi';
import type { AlbumItem, AlbumItemPayload } from '@/types/albumItem';

function sortAlbumItems(items: AlbumItem[]): AlbumItem[] {
  return [...items].sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
}

export const albumItemApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getAlbumItems: build.query<AlbumItem[], void>({
      query: () => '/api/album-items',
      transformResponse: (res: AlbumItem[]) => sortAlbumItems(res),
      providesTags: (result) =>
        result
          ? [
              ...result.map((a) => ({ type: 'AlbumItem' as const, id: a.id })),
              { type: 'AlbumItem' as const, id: 'LIST' },
            ]
          : [{ type: 'AlbumItem' as const, id: 'LIST' }],
    }),
    createAlbumItem: build.mutation<AlbumItem, AlbumItemPayload>({
      query: (body) => ({ url: '/api/album-items', method: 'POST', body }),
      invalidatesTags: [{ type: 'AlbumItem', id: 'LIST' }],
    }),
    deleteAlbumItem: build.mutation<void, string>({
      query: (id) => ({ url: `/api/album-items/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'AlbumItem', id },
        { type: 'AlbumItem', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetAlbumItemsQuery,
  useCreateAlbumItemMutation,
  useDeleteAlbumItemMutation,
} = albumItemApi;
