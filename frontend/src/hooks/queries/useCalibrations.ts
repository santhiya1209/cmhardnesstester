import { useCallback, useEffect, useRef, useState } from 'react';
import { getCalibrations } from '@/api/getCalibrations';
import type { Calibration } from '@/types/calibration';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function sortCalibrations(items: Calibration[]): Calibration[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    return leftTime - rightTime;
  });
}

export function useCalibrations() {
  const [data, setData] = useState<Calibration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getCalibrations();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(sortCalibrations(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load calibrations.'));
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
