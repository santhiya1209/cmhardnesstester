import { useCallback, useState } from 'react';
import {
  useCreateMicrometerConfigMutation,
  useUpdateMicrometerConfigMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { MicrometerConfig, MicrometerConfigPayload } from '@/types/micrometerConfig';

type Args = {
  id?: string;
  values: MicrometerConfigPayload;
};

export function useSaveMicrometerConfig() {
  const [createMicrometerConfig, createState] = useCreateMicrometerConfigMutation();
  const [updateMicrometerConfig, updateState] = useUpdateMicrometerConfigMutation();
  const [error, setError] = useState<string | null>(null);

  const saveMicrometerConfig = useCallback(
    async ({ id, values }: Args): Promise<MicrometerConfig> => {
      setError(null);
      try {
        if (id) return await updateMicrometerConfig({ id, values }).unwrap();
        return await createMicrometerConfig(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save micrometer config.'));
        throw requestError;
      }
    },
    [createMicrometerConfig, updateMicrometerConfig]
  );

  return { saveMicrometerConfig, saving: createState.isLoading || updateState.isLoading, error };
}
