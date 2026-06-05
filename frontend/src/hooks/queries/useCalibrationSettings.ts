import { useCallback, useMemo } from 'react';
import { useGetCalibrationSettingsQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import { selectLatestByUpdatedAt } from '@/store/selectLatest';

export function useCalibrationSettings() {
  const { data, isFetching, error, refetch } = useGetCalibrationSettingsQuery();
  const items = data ?? [];
  const current = useMemo(() => selectLatestByUpdatedAt(items), [items]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: current,
    items,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load calibration settings.'),
    refetch: doRefetch,
  };
}
