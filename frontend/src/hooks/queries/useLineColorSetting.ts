import { useCallback, useMemo } from 'react';
import { useGetLineColorSettingQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useLineColorSetting() {
  const { data, isFetching, error, refetch } = useGetLineColorSettingQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load line color setting.'),
    refetch: doRefetch,
  };
}
