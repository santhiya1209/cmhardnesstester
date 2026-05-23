import { useCallback, useState } from 'react';
import { connectMachine } from '@/api/machine';
import { disconnectMachine } from '@/api/machine';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';
import type { ConnectMachineRequest } from '@/types/machine';

export function useConnectMachine() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (payload: ConnectMachineRequest) => {
    setBusy(true);
    setError(null);
    try {
      const reply = await connectMachine(payload);
      return reply.state;
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to connect machine.');
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await disconnectMachine();
      return reply.state;
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to disconnect machine.');
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { connect, disconnect, busy, error };
}
