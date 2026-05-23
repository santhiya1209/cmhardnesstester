import { useCallback, useState } from 'react';
import { setMachineControlValue } from '@/api/machine';
import type { MachineControlKey } from '@/types/machine';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useSetMachineControl() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setControl = useCallback(
    async (key: MachineControlKey, value: string | number) => {
      setBusy(true);
      setError(null);
      try {
        const reply = await setMachineControlValue(key, value);
        return reply.state;
      } catch (err) {
        const message = getApiErrorMessage(err, 'Failed to update machine value.');
        setError(message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return { setControl, busy, error };
}
