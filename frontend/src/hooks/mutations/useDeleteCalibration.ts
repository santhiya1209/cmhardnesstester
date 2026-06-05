import { useCallback, useState } from 'react';
import { useDeleteCalibrationMutation } from '@/store/api/calibrationApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useDeleteCalibration() {
  const [deleteCalibration, state] = useDeleteCalibrationMutation();
  const [error, setError] = useState<string | null>(null);

  const removeCalibration = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      try {
        await deleteCalibration(id).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to delete calibration.'));
        throw requestError;
      }
    },
    [deleteCalibration]
  );

  return { removeCalibration, deleting: state.isLoading, error };
}
