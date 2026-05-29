import { useCallback, useEffect, useRef } from 'react';
import { useToolbarState } from '@/hooks/queries/useToolbarState';
import { useSaveToolbarState } from '@/hooks/mutations/useSaveToolbarState';
import type { ToolbarActionId } from '@/types/tool';

export interface UseToolbarActionPersistenceInput {
  setStatusMessage: (message: string) => void;
}

export interface ToolbarActionPersistenceApi {
  persistToolbarAction: (action: ToolbarActionId) => void;
  refetchToolbarState: () => Promise<void>;
}

export function useToolbarActionPersistence(
  input: UseToolbarActionPersistenceInput
): ToolbarActionPersistenceApi {
  const { setStatusMessage } = input;

  const {
    data: toolbarState,
    error: toolbarStateError,
    loading: toolbarStateLoading,
    refetch: refetchToolbarState,
  } = useToolbarState();
  const { saveToolbarState } = useSaveToolbarState();

  // Mirror the persisted row id so persistToolbarAction stays referentially
  // stable but always reads the current id at click time.
  const toolbarStateIdRef = useRef<string | undefined>(toolbarState?.id);
  useEffect(() => {
    toolbarStateIdRef.current = toolbarState?.id;
  }, [toolbarState?.id]);

  // One-shot restore: on first non-loading render after mount, surface the
  // persisted "last toolbar action" in the status bar (or the load error).
  const restoredToolbarActionRef = useRef(false);
  useEffect(() => {
    if (toolbarStateLoading || restoredToolbarActionRef.current) {
      return;
    }

    restoredToolbarActionRef.current = true;

    if (toolbarStateError) {
      setStatusMessage(`System Status: ${toolbarStateError}`);
      return;
    }

    if (toolbarState) {
      setStatusMessage(`System Status: Last toolbar action: ${toolbarState.lastAction}`);
    }
  }, [toolbarState, toolbarStateError, toolbarStateLoading, setStatusMessage]);

  const persistToolbarAction = useCallback(
    (action: ToolbarActionId) => {
      void (async () => {
        try {
          await saveToolbarState({
            id: toolbarStateIdRef.current,
            values: { lastAction: action },
          });
          await refetchToolbarState();
        } catch {
          // error surfaces via useSaveToolbarState's own error state
        }
      })();
    },
    [saveToolbarState, refetchToolbarState]
  );

  return { persistToolbarAction, refetchToolbarState };
}
