import { useCallback, useState } from 'react';
import { createMicrometerConfig } from '@/api/createMicrometerConfig';
import { updateMicrometerConfig } from '@/api/updateMicrometerConfig';
import type { MicrometerConfig, MicrometerConfigPayload } from '@/types/micrometerConfig';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type Args = {
  id?: string;
  values: MicrometerConfigPayload;
};

export function useSaveMicrometerConfig() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveMicrometerConfig = useCallback(
    async ({ id, values }: Args): Promise<MicrometerConfig> => {
      setSaving(true);
      setError(null);
      try {
        if (id) return await updateMicrometerConfig(id, values);
        return await createMicrometerConfig(values);
      } catch (err) {
        const message = getApiErrorMessage(err, 'Failed to save micrometer config.');
        setError(message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return { saveMicrometerConfig, saving, error };
}
