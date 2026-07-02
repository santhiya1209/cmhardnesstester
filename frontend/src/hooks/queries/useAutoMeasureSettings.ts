import { useCallback, useMemo } from 'react';
import { useGetAutoMeasureSettingsQuery } from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { AutoMeasureSettings } from '@/types/autoMeasureSettings';

/**
 * Auto Measure settings are persisted one row per objective (10X, 40X). The
 * caller resolves the active objective's row via
 * `resolveAutoMeasureSettingsForObjective`, so this hook exposes the full list
 * rather than a single "latest" record.
 */
export function useAutoMeasureSettings() {
  const { data, isFetching, error, refetch } = useGetAutoMeasureSettingsQuery();
  const all = useMemo<AutoMeasureSettings[]>(() => data ?? [], [data]);
  const doRefetch = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    all,
    loading: isFetching,
    error: rtkErrorMessage(error, 'Failed to load auto measure settings.'),
    refetch: doRefetch,
  };
}
