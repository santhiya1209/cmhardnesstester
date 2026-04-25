import { useCallback, useEffect, useRef, useState } from 'react';
import { getPatternPrograms } from '@/api/getPatternPrograms';
import type { PatternProgram } from '@/types/patternProgram';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function sortPatternPrograms(items: PatternProgram[]): PatternProgram[] {
  return [...items].sort((left, right) => {
    if (left.checked !== right.checked) {
      return Number(right.checked) - Number(left.checked);
    }

    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  });
}

export function usePatternPrograms() {
  const [data, setData] = useState<PatternProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getPatternPrograms();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(sortPatternPrograms(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load pattern programs.'));
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
