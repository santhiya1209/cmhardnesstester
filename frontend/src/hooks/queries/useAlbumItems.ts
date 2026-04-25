import { useCallback, useEffect, useRef, useState } from 'react';
import { getAlbumItems } from '@/api/getAlbumItems';
import type { AlbumItem } from '@/types/albumItem';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function sortAlbumItems(items: AlbumItem[]): AlbumItem[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.capturedAt);
    const rightTime = Date.parse(right.capturedAt);
    return rightTime - leftTime;
  });
}

export function useAlbumItems() {
  const [data, setData] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getAlbumItems();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(sortAlbumItems(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load album items.'));
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
