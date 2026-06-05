import { useCallback, useState } from 'react';
import { useImportCalibrationsMutation } from '@/store/api/calibrationApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { Calibration, CalibrationImportPayload } from '@/types/calibration';

export function useImportCalibrations() {
  const [importCalibrations, state] = useImportCalibrationsMutation();
  const [error, setError] = useState<string | null>(null);

  const importItems = useCallback(
    async (payload: CalibrationImportPayload): Promise<Calibration[]> => {
      setError(null);
      try {
        return await importCalibrations(payload).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to import calibrations.'));
        throw requestError;
      }
    },
    [importCalibrations]
  );

  return { importItems, importing: state.isLoading, error };
}
