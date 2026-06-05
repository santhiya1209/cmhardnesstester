import { useCallback, useState } from 'react';
import { useDeletePatternProgramMutation } from '@/store/api/patternProgramApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useDeletePatternProgram() {
  const [deletePatternProgram, deleteState] = useDeletePatternProgramMutation();
  const [error, setError] = useState<string | null>(null);

  const removePatternProgram = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      try {
        await deletePatternProgram(id).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to delete pattern program.'));
        throw requestError;
      }
    },
    [deletePatternProgram]
  );

  return {
    removePatternProgram,
    deleting: deleteState.isLoading,
    error,
  };
}
