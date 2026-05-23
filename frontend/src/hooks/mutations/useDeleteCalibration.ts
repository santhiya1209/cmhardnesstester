import { useCallback, useState } from 'react';
import { deleteCalibration } from '@/api/calibration';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useDeleteCalibration() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeCalibration = useCallback(async (id: string): Promise<void> => {
    setDeleting(true);
    setError(null);

    try {
      await deleteCalibration(id);
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to delete calibration.');
      setError(message);
      throw requestError;
    } finally {
      setDeleting(false);
    }
  }, []);

  return { removeCalibration, deleting, error };
}
