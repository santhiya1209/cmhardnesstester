import { baseApi } from './baseApi';
import type { Measurement, MeasurementSavePayload } from '@/types/measurement';

function sortMeasurements(items: Measurement[]): Measurement[] {
  return [...items].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

export const measurementApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMeasurements: build.query<Measurement[], void>({
      query: () => '/api/measurements',
      transformResponse: (res: Measurement[]) => sortMeasurements(res),
      providesTags: (result) =>
        result
          ? [
              ...result.map((m) => ({ type: 'Measurement' as const, id: m.id })),
              { type: 'Measurement' as const, id: 'LIST' },
            ]
          : [{ type: 'Measurement' as const, id: 'LIST' }],
    }),
    createMeasurement: build.mutation<Measurement, MeasurementSavePayload>({
      query: (body) => ({ url: '/api/measurements', method: 'POST', body }),
      invalidatesTags: [{ type: 'Measurement', id: 'LIST' }],
    }),
    updateMeasurement: build.mutation<Measurement, { id: string; values: MeasurementSavePayload }>({
      query: ({ id, values }) => ({ url: `/api/measurements/${id}`, method: 'PUT', body: values }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Measurement', id },
        { type: 'Measurement', id: 'LIST' },
      ],
    }),
    deleteMeasurement: build.mutation<void, string>({
      query: (id) => ({ url: `/api/measurements/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'Measurement', id },
        { type: 'Measurement', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetMeasurementsQuery,
  useCreateMeasurementMutation,
  useUpdateMeasurementMutation,
  useDeleteMeasurementMutation,
} = measurementApi;
