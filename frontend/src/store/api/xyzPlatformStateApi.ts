import { baseApi } from './baseApi';
import type { XYZPlatformState, XYZPlatformStatePayload } from '@/types/xyzPlatformState';

export const xyzPlatformStateApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getXyzPlatformStates: build.query<XYZPlatformState[], void>({
      query: () => '/api/xyz-platform-states',
      providesTags: (result) =>
        result
          ? [
              ...result.map((s) => ({ type: 'XyzPlatformState' as const, id: s.id })),
              { type: 'XyzPlatformState' as const, id: 'LIST' },
            ]
          : [{ type: 'XyzPlatformState' as const, id: 'LIST' }],
    }),
    createXyzPlatformState: build.mutation<XYZPlatformState, XYZPlatformStatePayload>({
      query: (body) => ({ url: '/api/xyz-platform-states', method: 'POST', body }),
      invalidatesTags: [{ type: 'XyzPlatformState', id: 'LIST' }],
    }),
    updateXyzPlatformState: build.mutation<
      XYZPlatformState,
      { id: string; values: XYZPlatformStatePayload }
    >({
      query: ({ id, values }) => ({ url: `/api/xyz-platform-states/${id}`, method: 'PUT', body: values }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'XyzPlatformState', id },
        { type: 'XyzPlatformState', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetXyzPlatformStatesQuery,
  useCreateXyzPlatformStateMutation,
  useUpdateXyzPlatformStateMutation,
} = xyzPlatformStateApi;
