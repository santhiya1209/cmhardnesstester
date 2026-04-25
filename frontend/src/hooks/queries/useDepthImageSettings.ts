import { useCallback, useEffect, useRef, useState } from 'react';
import { getDepthImageSettings } from '@/api/getDepthImageSettings';
import type { DepthImageSetting } from '@/types/depthImageSetting';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function selectCurrentDepthImageSetting(items: DepthImageSetting[]): DepthImageSetting | null {
  if (items.length === 0) {
    return null;
  }

  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  })[0];
}

export function useDepthImageSettings() {
  const [data, setData] = useState<DepthImageSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getDepthImageSettings();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(selectCurrentDepthImageSetting(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load depth image settings.'));
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
