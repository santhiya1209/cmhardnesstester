import { useCallback, useState } from 'react';
import {
  useCreateTestRecordMutation,
  useUpdateTestRecordMutation,
} from '@/store/api/testRecordApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { TestRecord, TestRecordSavePayload } from '@/types/testRecord';

type SaveTestRecordArgs = {
  id?: string;
  values: TestRecordSavePayload;
};

export function useSaveTestRecord() {
  const [createTestRecord, createState] = useCreateTestRecordMutation();
  const [updateTestRecord, updateState] = useUpdateTestRecordMutation();
  const [error, setError] = useState<string | null>(null);

  const saveTestRecord = useCallback(
    async ({ id, values }: SaveTestRecordArgs): Promise<TestRecord> => {
      setError(null);
      try {
        if (id) return await updateTestRecord({ id, values }).unwrap();
        return await createTestRecord(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save test record.'));
        throw requestError;
      }
    },
    [createTestRecord, updateTestRecord]
  );

  return {
    saveTestRecord,
    saving: createState.isLoading || updateState.isLoading,
    error,
  };
}
