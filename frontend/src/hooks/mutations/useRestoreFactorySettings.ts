import { useCallback, useState } from 'react';
import { useRestoreFactorySettingsMutation } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useRestoreFactorySettings() {
  const [restoreFactorySettings, state] = useRestoreFactorySettingsMutation();
  const [error, setError] = useState<string | null>(null);

  const restore = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await restoreFactorySettings().unwrap();
    } catch (requestError) {
      setError(rtkErrorMessage(requestError, 'Failed to restore factory settings.'));
      throw requestError;
    }
  }, [restoreFactorySettings]);

  return { restore, restoring: state.isLoading, error };
}
