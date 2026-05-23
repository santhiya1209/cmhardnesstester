import { useCallback, useState } from 'react';
import { startIndent } from '@/api/machine';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useStartIndent() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
      try {
        const reply = await startIndent();
      return reply.state;
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to start indent.');
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { start, busy, error };
}
