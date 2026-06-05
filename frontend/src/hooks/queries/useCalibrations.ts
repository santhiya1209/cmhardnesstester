import { useCallback } from 'react';
import { useGetCalibrationsQuery } from '@/store/api/calibrationApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useCalibrations() {
  const { data = [], isFetching, error, refetch } = useGetCalibrationsQuery();
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load calibrations.'),
    refetch: doRefetch,
  };
}
