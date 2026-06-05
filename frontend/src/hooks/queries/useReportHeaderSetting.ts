import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useCreateReportHeaderSettingMutation,
  useGetReportHeaderSettingsQuery,
  useUpdateReportHeaderSettingMutation,
} from '@/store/api/settingsApi';
import { rtkErrorMessage } from '@/store/rtkError';
import {
  DEFAULT_REPORT_HEADER_SETTING,
  type ReportHeaderSetting,
  type ReportHeaderSettingPayload,
} from '@/types/reportHeaderSetting';

export function useReportHeaderSetting(active: boolean) {
  const { data: rows, isFetching, error: loadError } = useGetReportHeaderSettingsQuery(undefined, {
    skip: !active,
  });
  const [createReportHeaderSetting] = useCreateReportHeaderSettingMutation();
  const [updateReportHeaderSetting, { isLoading: saving }] = useUpdateReportHeaderSettingMutation();

  const server: ReportHeaderSetting | null = rows && rows.length > 0 ? rows[0] : null;
  const [values, setValuesState] = useState<ReportHeaderSettingPayload>(DEFAULT_REPORT_HEADER_SETTING);
  const [saveError, setSaveError] = useState<string | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    if (server && !seededRef.current) {
      seededRef.current = true;
      setValuesState({
        sampleName: server.sampleName,
        sampleSerialNumber: server.sampleSerialNumber,
        inspectionCompany: server.inspectionCompany,
        tester: server.tester,
        reviewer: server.reviewer,
        hardnessMin: server.hardnessMin,
        hardnessMax: server.hardnessMax,
      });
    }
  }, [server]);

  const setValues = useCallback((patch: Partial<ReportHeaderSettingPayload>) => {
    setValuesState((current) => ({ ...current, ...patch }));
  }, []);

  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  const serverRef = useRef(server);
  useEffect(() => {
    serverRef.current = server;
  }, [server]);

  const persist = useCallback(async (): Promise<ReportHeaderSettingPayload> => {
    setSaveError(null);
    const next = valuesRef.current;
    const existing = serverRef.current;
    try {
      if (existing) {
        await updateReportHeaderSetting({ id: existing.id, values: next }).unwrap();
      } else {
        await createReportHeaderSetting(next).unwrap();
      }
      return next;
    } catch (requestError) {
      setSaveError(rtkErrorMessage(requestError, 'Failed to save report header setting.'));
      throw requestError;
    }
  }, [createReportHeaderSetting, updateReportHeaderSetting]);

  return {
    values,
    loading: isFetching,
    saving,
    error: saveError ?? rtkErrorMessage(loadError, 'Failed to load report header setting.'),
    setValues,
    persist,
  };
}
