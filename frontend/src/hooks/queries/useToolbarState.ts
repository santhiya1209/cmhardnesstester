import { useCallback, useEffect, useRef, useState } from 'react';
import { getToolbarStates } from '@/api/toolbar';
import type { ToolbarState } from '@/types/toolbarState';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function selectCurrentToolbarState(items: ToolbarState[]): ToolbarState | null {
  if (items.length === 0) {
    return null;
  }

  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  })[0];
}

export function useToolbarState() {
  const [data, setData] = useState<ToolbarState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getToolbarStates();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(selectCurrentToolbarState(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load toolbar state.'));
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
