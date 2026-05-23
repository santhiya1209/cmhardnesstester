import { useCallback, useState } from 'react';
import { sendTurret } from '@/api/machine';
import type { TurretDirection } from '@/types/machine';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useTurret() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = useCallback(async (direction: TurretDirection) => {
    setBusy(true);
    setError(null);
    try {
      const reply = await sendTurret(direction);
      return reply.state;
    } catch (err) {
      const message = getApiErrorMessage(err, `Failed to move turret ${direction}.`);
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { move, busy, error };
}
