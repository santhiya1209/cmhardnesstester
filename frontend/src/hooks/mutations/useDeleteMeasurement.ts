import { useCallback, useState } from 'react';
import { useDeleteMeasurementMutation } from '@/store/api/measurementApi';
import { rtkErrorMessage } from '@/store/rtkError';

export function useDeleteMeasurement() {
  const [deleteMeasurement, deleteState] = useDeleteMeasurementMutation();
  const [error, setError] = useState<string | null>(null);

  const removeMeasurement = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      try {
        await deleteMeasurement(id).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to delete measurement.'));
        throw requestError;
      }
    },
    [deleteMeasurement]
  );

  return {
    removeMeasurement,
    deleting: deleteState.isLoading,
    error,
  };
}
