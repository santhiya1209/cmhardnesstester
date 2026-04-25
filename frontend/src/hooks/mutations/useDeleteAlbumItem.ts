import { useCallback, useState } from 'react';
import { deleteAlbumItem } from '@/api/deleteAlbumItem';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useDeleteAlbumItem() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeAlbumItem = useCallback(async (id: string): Promise<void> => {
    setDeleting(true);
    setError(null);

    try {
      await deleteAlbumItem(id);
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to delete album item.');
      setError(message);
      throw requestError;
    } finally {
      setDeleting(false);
    }
  }, []);

  return {
    removeAlbumItem,
    deleting,
    error,
  };
}
