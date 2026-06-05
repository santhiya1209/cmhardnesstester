import { useCallback, useState } from 'react';
import {
  useCreatePatternProgramMutation,
  useUpdatePatternProgramMutation,
} from '@/store/api/patternProgramApi';
import { rtkErrorMessage } from '@/store/rtkError';
import type { PatternProgram, PatternProgramPayload } from '@/types/patternProgram';

type SavePatternProgramArgs = {
  id?: string;
  values: PatternProgramPayload;
};

export function useSavePatternProgram() {
  const [createPatternProgram, createState] = useCreatePatternProgramMutation();
  const [updatePatternProgram, updateState] = useUpdatePatternProgramMutation();
  const [error, setError] = useState<string | null>(null);

  const savePatternProgram = useCallback(
    async ({ id, values }: SavePatternProgramArgs): Promise<PatternProgram> => {
      setError(null);
      try {
        if (id) return await updatePatternProgram({ id, values }).unwrap();
        return await createPatternProgram(values).unwrap();
      } catch (requestError) {
        setError(rtkErrorMessage(requestError, 'Failed to save pattern program.'));
        throw requestError;
      }
    },
    [createPatternProgram, updatePatternProgram]
  );

  return {
    savePatternProgram,
    saving: createState.isLoading || updateState.isLoading,
    error,
  };
}
