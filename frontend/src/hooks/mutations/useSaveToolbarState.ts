import { useCallback, useState } from 'react';
import { createToolbarState } from '@/api/toolbar';
import { updateToolbarState } from '@/api/toolbar';
import type { ToolbarState, ToolbarStatePayload } from '@/types/toolbarState';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type SaveToolbarStateArgs = {
  id?: string;
  values: ToolbarStatePayload;
};

export function useSaveToolbarState() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveToolbarState = useCallback(
    async ({ id, values }: SaveToolbarStateArgs): Promise<ToolbarState> => {
      setSaving(true);
      setError(null);

      try {
        if (id) {
          return await updateToolbarState(id, values);
        }

        return await createToolbarState(values);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save toolbar state.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    saveToolbarState,
    saving,
    error,
  };
}
