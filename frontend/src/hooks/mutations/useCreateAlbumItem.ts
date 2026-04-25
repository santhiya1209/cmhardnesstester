import { useCallback, useState } from 'react';
import { createAlbumItem } from '@/api/createAlbumItem';
import type { AlbumItem, AlbumItemPayload } from '@/types/albumItem';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useCreateAlbumItem() {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addAlbumItem = useCallback(async (payload: AlbumItemPayload): Promise<AlbumItem> => {
    setCreating(true);
    setError(null);

    try {
      return await createAlbumItem(payload);
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to save album item.');
      setError(message);
      throw requestError;
    } finally {
      setCreating(false);
    }
  }, []);

  return {
    addAlbumItem,
    creating,
    error,
  };
}
