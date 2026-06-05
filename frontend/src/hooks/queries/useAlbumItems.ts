import { useCallback } from 'react';
import { useGetAlbumItemsQuery } from '@/store/api/albumItemApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useAlbumItems() {
  const { data = [], isFetching, error, refetch } = useGetAlbumItemsQuery();
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load album items.'),
    refetch: doRefetch,
  };
}
