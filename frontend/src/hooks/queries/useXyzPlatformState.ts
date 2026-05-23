import { useCallback, useEffect, useRef, useState } from 'react';
import { getXyzPlatformStates } from '@/api/xyzPlatform';
import type { XYZPlatformState } from '@/types/xyzPlatformState';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function selectCurrentXYZPlatformState(items: XYZPlatformState[]): XYZPlatformState | null {
  if (items.length === 0) {
    return null;
  }

  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  })[0];
}

export function useXyzPlatformState() {
  const [data, setData] = useState<XYZPlatformState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getXyzPlatformStates();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(selectCurrentXYZPlatformState(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load XYZ platform state.'));
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
