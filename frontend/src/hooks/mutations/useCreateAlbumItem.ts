import { useCallback, useState } from 'react';
import { useCreateAlbumItemMutation } from '@/store/api/albumItemApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { AlbumItem, AlbumItemPayload } from '@/types/albumItem';

export function useCreateAlbumItem() {
  const [createAlbumItem, state] = useCreateAlbumItemMutation();
  const [error, setError] = useState<string | null>(null);

  const addAlbumItem = useCallback(
    async (payload: AlbumItemPayload): Promise<AlbumItem> => {
      setError(null);
      try {
        return await createAlbumItem(payload).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save album item.'));
        throw requestError;
      }
    },
    [createAlbumItem]
  );

  return { addAlbumItem, creating: state.isLoading, error };
}
