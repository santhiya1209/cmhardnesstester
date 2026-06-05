import { useCallback, useState } from 'react';
import { useDeleteTestRecordMutation } from '@/store/api/testRecordApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useDeleteTestRecord() {
  const [deleteTestRecord, deleteState] = useDeleteTestRecordMutation();
  const [error, setError] = useState<string | null>(null);

  const removeTestRecord = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      try {
        await deleteTestRecord(id).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to delete test record.'));
        throw requestError;
      }
    },
    [deleteTestRecord]
  );

  return {
    removeTestRecord,
    deleting: deleteState.isLoading,
    error,
  };
}
