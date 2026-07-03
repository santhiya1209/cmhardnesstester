import { baseApi } from './baseApi';
import type { Measurement, MeasurementSavePayload } from '@/types/measurement';

// Newest-first. Typed structurally so it accepts both plain Measurements (the query
// result) and Immer drafts (inside updateQueryData recipes).
const byTimestampDesc = (left: { timestamp: string }, right: { timestamp: string }) =>
  Date.parse(right.timestamp) - Date.parse(left.timestamp);

export const measurementApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMeasurements: build.query<Measurement[], void>({
      query: () => '/api/measurements',
      transformResponse: (res: Measurement[]) => [...res].sort(byTimestampDesc),
      providesTags: (result) =>
        result
          ? [
              ...result.map((m) => ({ type: 'Measurement' as const, id: m.id })),
              { type: 'Measurement' as const, id: 'LIST' },
            ]
          : [{ type: 'Measurement' as const, id: 'LIST' }],
    }),

    // Every mutation patches the getMeasurements cache directly (updateQueryData)
    // instead of invalidating it. RTK Query applies patches via Immer, so rows the
    // mutation did not touch keep their object identity — the memoized
    // MeasurementRows for those rows never re-render. The cache is the single source
    // of truth; callers do NOT refetch after add/edit/delete.
    createMeasurement: build.mutation<Measurement, MeasurementSavePayload>({
      query: (body) => ({ url: '/api/measurements', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data: created } = await queryFulfilled;
        dispatch(
          measurementApi.util.updateQueryData('getMeasurements', undefined, (draft) => {
            draft.push(created);
            draft.sort(byTimestampDesc);
          })
        );
      },
    }),
    updateMeasurement: build.mutation<Measurement, { id: string; values: MeasurementSavePayload }>({
      query: ({ id, values }) => ({ url: `/api/measurements/${id}`, method: 'PUT', body: values }),
      async onQueryStarted({ id }, { dispatch, queryFulfilled }) {
        const { data: updated } = await queryFulfilled;
        dispatch(
          measurementApi.util.updateQueryData('getMeasurements', undefined, (draft) => {
            const index = draft.findIndex((m) => m.id === id);
            if (index !== -1) {
              draft[index] = updated;
            }
          })
        );
      },
    }),
    deleteMeasurement: build.mutation<void, string>({
      query: (id) => ({ url: `/api/measurements/${id}`, method: 'DELETE' }),
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        await queryFulfilled;
        dispatch(
          measurementApi.util.updateQueryData('getMeasurements', undefined, (draft) => {
            const index = draft.findIndex((m) => m.id === id);
            if (index !== -1) {
              draft.splice(index, 1);
            }
          })
        );
      },
    }),
    // Bulk session clear against the existing `DELETE /api/measurements` endpoint:
    // one request, then empty the cache once → a single render to the empty state.
    clearMeasurements: build.mutation<{ ok: boolean; deleted: number }, void>({
      query: () => ({ url: '/api/measurements', method: 'DELETE' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await queryFulfilled;
        dispatch(
          measurementApi.util.updateQueryData('getMeasurements', undefined, (draft) => {
            draft.length = 0;
          })
        );
      },
    }),
  }),
});

export const {
  useGetMeasurementsQuery,
  useCreateMeasurementMutation,
  useUpdateMeasurementMutation,
  useDeleteMeasurementMutation,
  useClearMeasurementsMutation,
} = measurementApi;
