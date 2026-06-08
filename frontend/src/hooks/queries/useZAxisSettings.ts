import { useCallback, useEffect, useState } from 'react';
import { getZAxisSettings } from '@/api/xyzPlatform';
import type { ZAxisSettings } from '@/types/zAxisSettings';

/**
 * Read-only view of the backend-owned Z Axis settings singleton. The backend
 * service is the source of truth; this hook only fetches the last confirmed
 * state over IPC. The consuming dialog refetches on open.
 */
export function useZAxisSettings() {
  const [data, setData] = useState<ZAxisSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getZAxisSettings();
      if (result.ok) {
        setData(result.settings);
      } else {
        setError(result.message ?? result.error ?? 'Failed to load Z Axis settings.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
