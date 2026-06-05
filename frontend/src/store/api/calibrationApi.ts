import { baseApi } from './baseApi';
import type {
  Calibration,
  CalibrationImportPayload,
  CalibrationSavePayload,
} from '@/types/calibration';

function sortCalibrations(items: Calibration[]): Calibration[] {
  const sorted = [...items].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  if (sorted.length > 0) {
    const objectives = [...new Set(sorted.map((c) => c.zoomTime))].join(',');
    // eslint-disable-next-line no-console
    console.log(`[calibration-restore] loadedCount=${sorted.length} objectives=${objectives}`);
  }
  return sorted;
}

export const calibrationApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getCalibrations: build.query<Calibration[], void>({
      query: () => '/api/calibrations',
      transformResponse: (res: Calibration[]) => sortCalibrations(res),
      providesTags: (result) =>
        result
          ? [
              ...result.map((c) => ({ type: 'Calibration' as const, id: c.id })),
              { type: 'Calibration' as const, id: 'LIST' },
            ]
          : [{ type: 'Calibration' as const, id: 'LIST' }],
    }),
    createCalibration: build.mutation<Calibration, CalibrationSavePayload>({
      query: (body) => ({ url: '/api/calibrations', method: 'POST', body }),
      invalidatesTags: [{ type: 'Calibration', id: 'LIST' }],
    }),
    deleteCalibration: build.mutation<void, string>({
      query: (id) => ({ url: `/api/calibrations/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'Calibration', id },
        { type: 'Calibration', id: 'LIST' },
      ],
    }),
    clearCalibrations: build.mutation<void, void>({
      query: () => ({ url: '/api/calibrations/clear', method: 'DELETE' }),
      invalidatesTags: [{ type: 'Calibration', id: 'LIST' }],
    }),
    importCalibrations: build.mutation<Calibration[], CalibrationImportPayload>({
      query: (body) => ({ url: '/api/calibrations/import', method: 'POST', body }),
      invalidatesTags: [{ type: 'Calibration', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetCalibrationsQuery,
  useCreateCalibrationMutation,
  useDeleteCalibrationMutation,
  useClearCalibrationsMutation,
  useImportCalibrationsMutation,
} = calibrationApi;
