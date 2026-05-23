import { useCallback, useState } from 'react';
import { getMachineState } from '@/api/machine';
import type { MachineState } from '@/types/machine';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useMachineStateSnapshot() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getSnapshot = useCallback(async (): Promise<MachineState | null> => {
    setLoading(true);
    setError(null);

    try {
      const reply = await getMachineState();
      return reply.state ?? null;
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        'Failed to read machine state.'
      );
      setError(message);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    getSnapshot,
    loading,
    error,
  };
}
