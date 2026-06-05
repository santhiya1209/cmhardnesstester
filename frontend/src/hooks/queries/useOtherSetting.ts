import { useCallback, useMemo } from 'react';
import { useGetOtherSettingQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useOtherSetting() {
  const { data, isFetching, error, refetch } = useGetOtherSettingQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load other setting.'),
    refetch: doRefetch,
  };
}
