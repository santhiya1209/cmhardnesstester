import { useCallback, useMemo } from 'react';
import { useGetDepthImageSettingsQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useDepthImageSettings() {
  const { data, isFetching, error, refetch } = useGetDepthImageSettingsQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load depth image settings.'),
    refetch: doRefetch,
  };
}
