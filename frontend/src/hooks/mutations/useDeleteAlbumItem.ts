import { useCallback, useState } from 'react';
import { useDeleteAlbumItemMutation } from '@/store/api/albumItemApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useDeleteAlbumItem() {
  const [deleteAlbumItem, state] = useDeleteAlbumItemMutation();
  const [error, setError] = useState<string | null>(null);

  const removeAlbumItem = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      try {
        await deleteAlbumItem(id).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to delete album item.'));
        throw requestError;
      }
    },
    [deleteAlbumItem]
  );

  return { removeAlbumItem, deleting: state.isLoading, error };
}
