import { useCallback, useState } from 'react';
import { deletePatternProgram } from '@/api/patternProgram';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useDeletePatternProgram() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removePatternProgram = useCallback(async (id: string): Promise<void> => {
    setDeleting(true);
    setError(null);

    try {
      await deletePatternProgram(id);
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to delete pattern program.');
      setError(message);
      throw requestError;
    } finally {
      setDeleting(false);
    }
  }, []);

  return {
    removePatternProgram,
    deleting,
    error,
  };
}
