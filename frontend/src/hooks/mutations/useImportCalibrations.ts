import { useCallback, useState } from 'react';
import { importCalibrations } from '@/api/calibration';
import type { Calibration, CalibrationImportPayload } from '@/types/calibration';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

export function useImportCalibrations() {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importItems = useCallback(
    async (payload: CalibrationImportPayload): Promise<Calibration[]> => {
      setImporting(true);
      setError(null);

      try {
        return await importCalibrations(payload);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to import calibrations.');
        setError(message);
        throw requestError;
      } finally {
        setImporting(false);
      }
    },
    []
  );

  return { importItems, importing, error };
}
