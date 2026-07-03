import { useCallback, useState } from 'react';
import { useClearMeasurementsMutation } from '@/store/api/measurementApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useClearMeasurements() {
  const [clearMeasurementsMutation, clearState] = useClearMeasurementsMutation();
  const [error, setError] = useState<string | null>(null);

  const clearMeasurements = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await clearMeasurementsMutation().unwrap();
    } catch (requestError) {
      setError(rtkErrorMessage(requestError, 'Failed to clear measurements.'));
      throw requestError;
    }
  }, [clearMeasurementsMutation]);

  return {
    clearMeasurements,
    clearing: clearState.isLoading,
    error,
  };
}
