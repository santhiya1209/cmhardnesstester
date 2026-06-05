import { baseApi } from './baseApi';
import type { TestRecord, TestRecordSavePayload } from '@/types/testRecord';

function sortTestRecords(items: TestRecord[]): TestRecord[] {
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export const testRecordApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getTestRecords: build.query<TestRecord[], void>({
      query: () => '/api/test-records',
      transformResponse: (res: TestRecord[]) => sortTestRecords(res),
      providesTags: (result) =>
        result
          ? [
              ...result.map((r) => ({ type: 'TestRecord' as const, id: r.id })),
              { type: 'TestRecord' as const, id: 'LIST' },
            ]
          : [{ type: 'TestRecord' as const, id: 'LIST' }],
    }),
    createTestRecord: build.mutation<TestRecord, TestRecordSavePayload>({
      query: (body) => ({ url: '/api/test-records', method: 'POST', body }),
      invalidatesTags: [{ type: 'TestRecord', id: 'LIST' }],
    }),
    updateTestRecord: build.mutation<TestRecord, { id: string; values: TestRecordSavePayload }>({
      query: ({ id, values }) => ({ url: `/api/test-records/${id}`, method: 'PUT', body: values }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'TestRecord', id },
        { type: 'TestRecord', id: 'LIST' },
      ],
    }),
    deleteTestRecord: build.mutation<void, string>({
      query: (id) => ({ url: `/api/test-records/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'TestRecord', id },
        { type: 'TestRecord', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetTestRecordsQuery,
  useCreateTestRecordMutation,
  useUpdateTestRecordMutation,
  useDeleteTestRecordMutation,
} = testRecordApi;
