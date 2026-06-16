import { useCallback, useState } from 'react';
import { useCreateMultipointResultMutation } from '@/store/api/multipointResultApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { MultipointResult, MultipointResultSavePayload } from '@/types/multipointResult';

/**
 * Persist one executed Multipoint point's run record. Separate from the
 * measurement save (which owns HV/D1/D2) — this is the run-execution outcome.
 */
export function useSaveMultipointResult() {
  const [createMultipointResult, createState] = useCreateMultipointResultMutation();
  const [error, setError] = useState<string | null>(null);

  const saveMultipointResult = useCallback(
    async (values: MultipointResultSavePayload): Promise<MultipointResult> => {
      setError(null);
      try {
        return await createMultipointResult(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save multipoint result.'));
        throw requestError;
      }
    },
    [createMultipointResult]
  );

  return { saveMultipointResult, saving: createState.isLoading, error };
}
