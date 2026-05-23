import { useCallback, useState } from 'react';
import { createCalibration } from '@/api/calibration';
import type { Calibration, CalibrationSavePayload } from '@/types/calibration';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useCreateCalibration() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveCalibration = useCallback(
    async (payload: CalibrationSavePayload): Promise<Calibration> => {
      setSaving(true);
      setError(null);

      try {
        return await createCalibration(payload);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save calibration.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return { saveCalibration, saving, error };
}
