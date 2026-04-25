import { useCallback, useEffect, useRef, useState } from 'react';
import { getTestRecords } from '@/api/getTestRecords';
import type { TestRecord } from '@/types/testRecord';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function sortTestRecords(items: TestRecord[]): TestRecord[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  });
}

export function useTestRecords() {
  const [data, setData] = useState<TestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getTestRecords();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(sortTestRecords(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load test records.'));
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
