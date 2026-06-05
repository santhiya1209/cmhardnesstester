import { useCallback, useMemo } from 'react';
import { useGetGenericSettingQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useGenericSetting() {
  const { data, isFetching, error, refetch } = useGetGenericSettingQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load generic setting.'),
    refetch: doRefetch,
  };
}
