import { useCallback, useState } from 'react';
import { deleteMeasurement } from '@/api/measurement';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useDeleteMeasurement() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeMeasurement = useCallback(async (id: string): Promise<void> => {
    setDeleting(true);
    setError(null);

    try {
      await deleteMeasurement(id);
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to delete measurement.');
      setError(message);
      throw requestError;
    } finally {
      setDeleting(false);
    }
  }, []);

  return {
    removeMeasurement,
    deleting,
    error,
  };
}
