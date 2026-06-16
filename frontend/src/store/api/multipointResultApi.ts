import { baseApi } from './baseApi';
import type { MultipointResult, MultipointResultSavePayload } from '@/types/multipointResult';

export const multipointResultApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMultipointResults: build.query<MultipointResult[], void>({
      query: () => '/api/multipoint-results',
      providesTags: (result) =>
        result
          ? [
              ...result.map((r) => ({ type: 'MultipointResult' as const, id: r.id })),
              { type: 'MultipointResult' as const, id: 'LIST' },
            ]
          : [{ type: 'MultipointResult' as const, id: 'LIST' }],
    }),
    createMultipointResult: build.mutation<MultipointResult, MultipointResultSavePayload>({
      query: (body) => ({ url: '/api/multipoint-results', method: 'POST', body }),
      invalidatesTags: [{ type: 'MultipointResult', id: 'LIST' }],
    }),
    deleteMultipointResult: build.mutation<void, string>({
      query: (id) => ({ url: `/api/multipoint-results/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'MultipointResult', id },
        { type: 'MultipointResult', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetMultipointResultsQuery,
  useCreateMultipointResultMutation,
  useDeleteMultipointResultMutation,
} = multipointResultApi;
