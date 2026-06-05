import { useCallback, useMemo } from 'react';
import { useGetMachineSettingsQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useMachineSettings() {
  const { data, isFetching, error, refetch } = useGetMachineSettingsQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load machine settings.'),
    refetch: doRefetch,
  };
}
