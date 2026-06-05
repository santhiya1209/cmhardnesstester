import { useCallback } from 'react';
import { useGetPatternProgramsQuery } from '@/store/api/patternProgramApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function usePatternPrograms() {
  const { data = [], isFetching, error, refetch } = useGetPatternProgramsQuery();
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load pattern programs.'),
    refetch: doRefetch,
  };
}
