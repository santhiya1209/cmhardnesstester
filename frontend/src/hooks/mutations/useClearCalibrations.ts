import { useCallback, useState } from 'react';
import { clearCalibrations } from '@/api/calibration';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useClearCalibrations() {
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearAll = useCallback(async (): Promise<void> => {
    setClearing(true);
    setError(null);

    try {
      await clearCalibrations();
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to clear calibrations.');
      setError(message);
      throw requestError;
    } finally {
      setClearing(false);
    }
  }, []);

  return { clearAll, clearing, error };
}
