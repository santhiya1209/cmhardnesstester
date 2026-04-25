import { useCallback, useState } from 'react';
import { createXyzPlatformState } from '@/api/createXyzPlatformState';
import { updateXyzPlatformState } from '@/api/updateXyzPlatformState';
import type {
  XYZPlatformState,
  XYZPlatformStatePayload,
} from '@/types/xyzPlatformState';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type SaveXyzPlatformStateArgs = {
  id?: string;
  values: XYZPlatformStatePayload;
};

export function useSaveXyzPlatformState() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveXyzPlatformState = useCallback(
    async ({ id, values }: SaveXyzPlatformStateArgs): Promise<XYZPlatformState> => {
      setSaving(true);
      setError(null);

      try {
        if (id) {
          return await updateXyzPlatformState(id, values);
        }

        return await createXyzPlatformState(values);
      } catch (requestError) {
        const message = getApiErrorMessage(requestError, 'Failed to save XYZ platform state.');
        setError(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    saveXyzPlatformState,
    saving,
    error,
  };
}
