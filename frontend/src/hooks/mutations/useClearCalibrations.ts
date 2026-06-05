import { useCallback, useState } from 'react';
import { useClearCalibrationsMutation } from '@/store/api/calibrationApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useClearCalibrations() {
  const [clearCalibrations, state] = useClearCalibrationsMutation();
  const [error, setError] = useState<string | null>(null);

  const clearAll = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await clearCalibrations().unwrap();
    } catch (requestError) {
      setError(rtkErrorMessage(requestError, 'Failed to clear calibrations.'));
      throw requestError;
    }
  }, [clearCalibrations]);

  return { clearAll, clearing: state.isLoading, error };
}
