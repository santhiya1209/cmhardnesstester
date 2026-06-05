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

  const toolbarStateIdRef = useRef<string | undefined>(toolbarState?.id);
  useEffect(() => {
    toolbarStateIdRef.current = toolbarState?.id;
  }, [toolbarState?.id]);

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
        }
      })();
    },
    [saveToolbarState, refetchToolbarState]
  );

  return { persistToolbarAction, refetchToolbarState };
}
