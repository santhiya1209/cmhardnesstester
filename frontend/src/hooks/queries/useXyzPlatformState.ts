import { useCallback, useMemo } from 'react';
import { useGetXyzPlatformStatesQuery } from '@/store/api/xyzPlatformStateApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { XYZPlatformState } from '@/types/xyzPlatformState';

function selectCurrentXYZPlatformState(items: XYZPlatformState[]): XYZPlatformState | null {
  if (items.length === 0) return null;
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

export function useXyzPlatformState() {
  const { data, isFetching, error, refetch } = useGetXyzPlatformStatesQuery();
  const current = useMemo(() => selectCurrentXYZPlatformState(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load XYZ platform state.'),
    refetch: doRefetch,
  };
}
