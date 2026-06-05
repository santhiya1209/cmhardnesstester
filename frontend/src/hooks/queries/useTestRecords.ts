import { useCallback } from 'react';
import { useGetTestRecordsQuery } from '@/store/api/testRecordApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useTestRecords() {
  const { data = [], isFetching, error, refetch } = useGetTestRecordsQuery();
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load test records.'),
    refetch: doRefetch,
  };
}
