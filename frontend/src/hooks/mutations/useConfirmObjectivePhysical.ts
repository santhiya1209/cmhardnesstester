import { useCallback, useState } from 'react';
import { confirmObjectivePhysical } from '@/api/machine';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useConfirmObjectivePhysical() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await confirmObjectivePhysical();
      return reply.state;
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to confirm physical objective.');
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { confirm, busy, error };
}
