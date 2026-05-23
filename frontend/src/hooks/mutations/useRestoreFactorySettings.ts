import { useCallback, useState } from 'react';
import { restoreFactorySettings } from '@/api/settings';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useRestoreFactorySettings() {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = useCallback(async (): Promise<void> => {
    setRestoring(true);
    setError(null);
    try {
      await restoreFactorySettings();
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to restore factory settings.');
      setError(message);
      throw requestError;
    } finally {
      setRestoring(false);
    }
  }, []);

  return { restore, restoring, error };
}
