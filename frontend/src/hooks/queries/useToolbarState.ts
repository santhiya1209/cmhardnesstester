import { useCallback, useMemo } from 'react';
import { useGetToolbarStatesQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useToolbarState() {
  const { data, isFetching, error, refetch } = useGetToolbarStatesQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load toolbar state.'),
    refetch: doRefetch,
  };
}
