import { useCallback, useEffect, useRef, useState } from 'react';
import { getAutoMeasureSettings } from '@/api/settings';
import type { AutoMeasureSettings } from '@/types/autoMeasureSettings';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function selectCurrentAutoMeasureSettings(items: AutoMeasureSettings[]): AutoMeasureSettings | null {
  if (items.length === 0) {
    return null;
  }

  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  })[0];
}

export function useAutoMeasureSettings() {
  const [data, setData] = useState<AutoMeasureSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getAutoMeasureSettings();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(selectCurrentAutoMeasureSettings(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load auto measure settings.'));
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
