import { useCallback, useMemo } from 'react';
import { useGetCameraSettingQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useCameraSetting() {
  const { data, isFetching, error, refetch } = useGetCameraSettingQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load camera setting.'),
    refetch: doRefetch,
  };
}
