import { useCallback, useEffect, useRef, useState } from 'react';
import { getCameraSetting } from '@/api/getCameraSetting';
import type { CameraSetting } from '@/types/cameraSetting';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function selectCurrent(items: CameraSetting[]): CameraSetting | null {
  if (items.length === 0) return null;
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  })[0];
}

export function useCameraSetting() {
  const [data, setData] = useState<CameraSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getCameraSetting();
      if (requestIdRef.current !== requestId) return;
      setData(selectCurrent(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) return;
      setError(getApiErrorMessage(requestError, 'Failed to load camera setting.'));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
