import { useCallback, useMemo } from 'react';
import { useGetAutoMeasureSettingsQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useAutoMeasureSettings() {
  const { data, isFetching, error, refetch } = useGetAutoMeasureSettingsQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load auto measure settings.'),
    refetch: doRefetch,
  };
}
