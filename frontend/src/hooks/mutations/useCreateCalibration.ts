import { useCallback, useState } from 'react';
import { useCreateCalibrationMutation } from '@/store/api/calibrationApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { Calibration, CalibrationSavePayload } from '@/types/calibration';

export function useCreateCalibration() {
  const [createCalibration, state] = useCreateCalibrationMutation();
  const [error, setError] = useState<string | null>(null);

  const saveCalibration = useCallback(
    async (payload: CalibrationSavePayload): Promise<Calibration> => {
      setError(null);
      try {
        return await createCalibration(payload).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save calibration.'));
        throw requestError;
      }
    },
    [createCalibration]
  );

  return { saveCalibration, saving: state.isLoading, error };
}
