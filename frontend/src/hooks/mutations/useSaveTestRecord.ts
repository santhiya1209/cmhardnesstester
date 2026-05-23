import { useCallback, useState } from 'react';
import { createTestRecord } from '@/api/testRecord';
import { updateTestRecord } from '@/api/testRecord';
import type { TestRecord, TestRecordSavePayload } from '@/types/testRecord';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';

type SaveTestRecordArgs = {
  id?: string;
  values: TestRecordSavePayload;
};

export function useSaveTestRecord() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveTestRecord = useCallback(async ({ id, values }: SaveTestRecordArgs): Promise<TestRecord> => {
    setSaving(true);
    setError(null);

    try {
      if (id) {
        return await updateTestRecord(id, values);
      }

      return await createTestRecord(values);
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, 'Failed to save test record.');
      setError(message);
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    saveTestRecord,
    saving,
    error,
  };
}
