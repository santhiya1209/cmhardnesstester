import { useCallback, useEffect, useRef, useState } from 'react';
import { getCalibrationSettings } from '@/api/getCalibrationSettings';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

function selectCurrentCalibrationSettings(items: CalibrationSettings[]): CalibrationSettings | null {
  if (items.length === 0) {
    return null;
  }

  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  })[0];
}

export function useCalibrationSettings() {
  const [data, setData] = useState<CalibrationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const items = await getCalibrationSettings();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setData(selectCurrentCalibrationSettings(items));
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setError(getApiErrorMessage(requestError, 'Failed to load calibration settings.'));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    data,
    loading,
    error,
    refetch,
  };
}
