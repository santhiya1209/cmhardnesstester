import { useCallback } from 'react';
import { useSaveXyzPlatformState } from '@/hooks/mutations/useSaveXyzPlatformState';
import { useXyzPlatformState } from '@/hooks/queries/useXyzPlatformState';
import type { XYZPlatformStatePayload } from '@/types/xyzPlatformState';

/**
 * Owns the XYZ-platform CRUD persistence ONLY — the last-known UI state
 * (speeds, coordinates, lock/focus flags, lastAction). It never sends a
 * hardware command and never fabricates movement; coordinate values written
 * here come from the caller (which gates them on real hardware RX).
 */
export function useXyzPlatformStateSync() {
  const { data: persistedState, error: loadError, loading, refetch } = useXyzPlatformState();
  const { error: saveError, saveXyzPlatformState, saving } = useSaveXyzPlatformState();

  const persist = useCallback(
    async (values: XYZPlatformStatePayload) => {
      await saveXyzPlatformState({ id: persistedState?.id, values });
      await refetch();
    },
    [persistedState?.id, refetch, saveXyzPlatformState]
  );

  return {
    persistedState,
    loading,
    saving,
    error: loadError ?? saveError,
    persist,
    refetch,
  };
}
