import { useCallback, useState } from 'react';
import {
  useCreateMeasurementMutation,
  useUpdateMeasurementMutation,
} from '@/store/api/measurementApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { Measurement, MeasurementSavePayload } from '@/types/measurement';

type SaveMeasurementArgs = {
  id?: string;
  values: MeasurementSavePayload;
};

export function useSaveMeasurement() {
  const [createMeasurement, createState] = useCreateMeasurementMutation();
  const [updateMeasurement, updateState] = useUpdateMeasurementMutation();
  const [error, setError] = useState<string | null>(null);

  const saveMeasurement = useCallback(
    async ({ id, values }: SaveMeasurementArgs): Promise<Measurement> => {
      setError(null);
      try {
        if (id) {
          return await updateMeasurement({ id, values }).unwrap();
        }
        return await createMeasurement(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save measurement.'));
        throw requestError;
      }
    },
    [createMeasurement, updateMeasurement]
  );

  return {
    saveMeasurement,
    saving: createState.isLoading || updateState.isLoading,
    error,
  };
}
