import { useCallback, useMemo } from 'react';
import { useGetSerialPortSettingQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useSerialPortSetting() {
  const { data, isFetching, error, refetch } = useGetSerialPortSettingQuery();
  const current = useMemo(() => selectLatestByUpdatedAt(data ?? []), [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load serial port setting.'),
    refetch: doRefetch,
  };
}
