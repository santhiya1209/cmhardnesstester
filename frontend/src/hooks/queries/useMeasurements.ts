import { useCallback, useEffect, useRef, useState } from 'react';
import { getMeasurements } from '@/api/measurement';
import type { Measurement } from '@/types/measurement';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function sortMeasurements(items: Measurement[]): Measurement[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    return rightTime - leftTime;
  });
}

export function useMeasurements() {
  const [data, setData] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getMeasurements();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(sortMeasurements(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load measurements.'));
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
