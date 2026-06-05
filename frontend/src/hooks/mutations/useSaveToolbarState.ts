import { useCallback, useState } from 'react';
import {
  useCreateToolbarStateMutation,
  useUpdateToolbarStateMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { ToolbarState, ToolbarStatePayload } from '@/types/toolbarState';

type SaveToolbarStateArgs = {
  id?: string;
  values: ToolbarStatePayload;
};

export function useSaveToolbarState() {
  const [createToolbarState, createState] = useCreateToolbarStateMutation();
  const [updateToolbarState, updateState] = useUpdateToolbarStateMutation();
  const [error, setError] = useState<string | null>(null);

  const saveToolbarState = useCallback(
    async ({ id, values }: SaveToolbarStateArgs): Promise<ToolbarState> => {
      setError(null);
      try {
        if (id) return await updateToolbarState({ id, values }).unwrap();
        return await createToolbarState(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save toolbar state.'));
        throw requestError;
      }
    },
    [createToolbarState, updateToolbarState]
  );

  return {
    saveToolbarState,
    saving: createState.isLoading || updateState.isLoading,
    error,
  };
}
