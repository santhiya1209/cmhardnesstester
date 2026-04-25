import { useCallback, useState } from 'react';
import { deleteTestRecord } from '@/api/deleteTestRecord';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useDeleteTestRecord() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeTestRecord = useCallback(async (id: string): Promise<void> => {
    setDeleting(true);
    setError(null);

    try {
      await deleteTestRecord(id);
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to delete test record.');
      setError(message);
      throw requestError;
    } finally {
      setDeleting(false);
    }
  }, []);

  return {
    removeTestRecord,
    deleting,
    error,
  };
}
