import { useCallback, useEffect, useRef, useState } from 'react';
import { getMachineSettings } from '@/api/getMachineSettings';
import type { MachineSettings } from '@/types/machineSettings';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function selectCurrentMachineSettings(items: MachineSettings[]): MachineSettings | null {
  if (items.length === 0) {
    return null;
  }

  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  })[0];
}

export function useMachineSettings() {
  const [data, setData] = useState<MachineSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getMachineSettings();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(selectCurrentMachineSettings(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load machine settings.'));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    data,
    loading,
    error,
    refetch,
  };
}
