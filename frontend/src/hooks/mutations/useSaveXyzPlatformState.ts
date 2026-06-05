import { useCallback, useState } from 'react';
import {
  useCreateXyzPlatformStateMutation,
  useUpdateXyzPlatformStateMutation,
} from '@/store/api/xyzPlatformStateApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { XYZPlatformState, XYZPlatformStatePayload } from '@/types/xyzPlatformState';

type SaveXyzPlatformStateArgs = {
  id?: string;
  values: XYZPlatformStatePayload;
};

export function useSaveXyzPlatformState() {
  const [createXyzPlatformState, createState] = useCreateXyzPlatformStateMutation();
  const [updateXyzPlatformState, updateState] = useUpdateXyzPlatformStateMutation();
  const [error, setError] = useState<string | null>(null);

  const saveXyzPlatformState = useCallback(
    async ({ id, values }: SaveXyzPlatformStateArgs): Promise<XYZPlatformState> => {
      setError(null);
      try {
        if (id) return await updateXyzPlatformState({ id, values }).unwrap();
        return await createXyzPlatformState(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save XYZ platform state.'));
        throw requestError;
      }
    },
    [createXyzPlatformState, updateXyzPlatformState]
  );

  return {
    saveXyzPlatformState,
    saving: createState.isLoading || updateState.isLoading,
    error,
  };
}
