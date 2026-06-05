import { baseApi } from './baseApi';
import type { PatternProgram, PatternProgramPayload } from '@/types/patternProgram';

function sortPatternPrograms(items: PatternProgram[]): PatternProgram[] {
  return [...items].sort((left, right) => {
    if (left.checked !== right.checked) return Number(right.checked) - Number(left.checked);
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

export const patternProgramApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getPatternPrograms: build.query<PatternProgram[], void>({
      query: () => '/api/pattern-programs',
      transformResponse: (res: PatternProgram[]) => sortPatternPrograms(res),
      providesTags: (result) =>
        result
          ? [
              ...result.map((p) => ({ type: 'PatternProgram' as const, id: p.id })),
              { type: 'PatternProgram' as const, id: 'LIST' },
            ]
          : [{ type: 'PatternProgram' as const, id: 'LIST' }],
    }),
    createPatternProgram: build.mutation<PatternProgram, PatternProgramPayload>({
      query: (body) => ({ url: '/api/pattern-programs', method: 'POST', body }),
      invalidatesTags: [{ type: 'PatternProgram', id: 'LIST' }],
    }),
    updatePatternProgram: build.mutation<PatternProgram, { id: string; values: PatternProgramPayload }>({
      query: ({ id, values }) => ({ url: `/api/pattern-programs/${id}`, method: 'PUT', body: values }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'PatternProgram', id },
        { type: 'PatternProgram', id: 'LIST' },
      ],
    }),
    deletePatternProgram: build.mutation<void, string>({
      query: (id) => ({ url: `/api/pattern-programs/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'PatternProgram', id },
        { type: 'PatternProgram', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetPatternProgramsQuery,
  useCreatePatternProgramMutation,
  useUpdatePatternProgramMutation,
  useDeletePatternProgramMutation,
} = patternProgramApi;
