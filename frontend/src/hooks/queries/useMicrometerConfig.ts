import { useCallback, useEffect, useRef, useState } from 'react';
import { getMicrometerConfig } from '@/api/micrometer';
import type { MicrometerConfig } from '@/types/micrometerConfig';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function selectCurrent(items: MicrometerConfig[]): MicrometerConfig | null {
  if (items.length === 0) return null;
  return [...items].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  )[0];
}

export function useMicrometerConfig() {
  const [data, setData] = useState<MicrometerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const items = await getMicrometerConfig();
      if (requestIdRef.current !== requestId) return;
      setData(selectCurrent(items));
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setError(getApiErrorMessage(err, 'Failed to load micrometer config.'));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
