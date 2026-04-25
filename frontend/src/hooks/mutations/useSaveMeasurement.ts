import { useCallback, useState } from 'react';
import { createMeasurement } from '@/api/createMeasurement';
import { updateMeasurement } from '@/api/updateMeasurement';
import type { Measurement, MeasurementSavePayload } from '@/types/measurement';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type SaveMeasurementArgs = {
  id?: string;
  values: MeasurementSavePayload;
};

export function useSaveMeasurement() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveMeasurement = useCallback(async ({ id, values }: SaveMeasurementArgs): Promise<Measurement> => {
    setSaving(true);
    setError(null);

    try {
      if (id) {
        return await updateMeasurement(id, values);
      }

      return await createMeasurement(values);
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to save measurement.');
      setError(message);
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    saveMeasurement,
    saving,
    error,
  };
}
