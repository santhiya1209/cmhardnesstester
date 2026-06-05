import { useCallback, useMemo } from 'react';
import { useGetMicrometerConfigQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useMicrometerConfig() {
  const { data, isFetching, error, refetch } = useGetMicrometerConfigQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load micrometer config.'),
    refetch: doRefetch,
  };
}
