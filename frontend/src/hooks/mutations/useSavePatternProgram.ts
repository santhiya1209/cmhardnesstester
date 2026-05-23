import { useCallback, useState } from 'react';
import { createPatternProgram } from '@/api/patternProgram';
import { updatePatternProgram } from '@/api/patternProgram';
import type { PatternProgram, PatternProgramPayload } from '@/types/patternProgram';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type SavePatternProgramArgs = {
  id?: string;
  values: PatternProgramPayload;
};

export function useSavePatternProgram() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savePatternProgram = useCallback(
    async ({ id, values }: SavePatternProgramArgs): Promise<PatternProgram> => {
      setSaving(true);
      setError(null);

      try {
        if (id) {
          return await updatePatternProgram(id, values);
        }

        return await createPatternProgram(values);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save pattern program.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    savePatternProgram,
    saving,
    error,
  };
}
