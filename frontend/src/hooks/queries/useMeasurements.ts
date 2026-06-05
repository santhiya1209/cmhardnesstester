import { useCallback } from 'react';
import { useGetMeasurementsQuery } from '@/store/api/measurementApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useMeasurements() {
  const { data = [], isFetching, error, refetch } = useGetMeasurementsQuery();
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load measurements.'),
    refetch: doRefetch,
  };
}
