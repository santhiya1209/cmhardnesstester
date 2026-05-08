import { useCallback, useEffect, useRef, useState } from 'react';
import { createReportHeaderSetting } from '@/api/createReportHeaderSetting';
import { getReportHeaderSettings } from '@/api/getReportHeaderSettings';
import { updateReportHeaderSetting } from '@/api/updateReportHeaderSetting';
import {
  DEFAULT_REPORT_HEADER_SETTING,
  type ReportHeaderSetting,
  type ReportHeaderSettingPayload,
} from '@/types/reportHeaderSetting';

type State = {
  data: ReportHeaderSetting | null;
  values: ReportHeaderSettingPayload;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

export function useReportHeaderSetting(active: boolean) {
  const [state, setState] = useState<State>({
    data: null,
    values: DEFAULT_REPORT_HEADER_SETTING,
    loading: false,
    saving: false,
    error: null,
  });
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!active || loadedRef.current) return;
    loadedRef.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    getReportHeaderSettings()
      .then((rows) => {
        const first = rows[0] ?? null;
        setState({
          data: first,
          values: first
            ? {
                sampleName: first.sampleName,
                sampleSerialNumber: first.sampleSerialNumber,
                inspectionCompany: first.inspectionCompany,
                tester: first.tester,
                reviewer: first.reviewer,
                hardnessMin: first.hardnessMin,
                hardnessMax: first.hardnessMax,
              }
            : DEFAULT_REPORT_HEADER_SETTING,
          loading: false,
          saving: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, loading: false, error: message }));
      });
  }, [active]);

  const setValues = useCallback(
    (patch: Partial<ReportHeaderSettingPayload>) => {
      setState((s) => ({ ...s, values: { ...s.values, ...patch } }));
    },
    []
  );

  const persist = useCallback(async (): Promise<ReportHeaderSettingPayload> => {
    setState((s) => ({ ...s, saving: true, error: null }));
    try {
      const current = stateRef.current;
      const saved = current.data
        ? await updateReportHeaderSetting(current.data.id, current.values)
        : await createReportHeaderSetting(current.values);
      setState((s) => ({ ...s, data: saved, saving: false }));
      return current.values;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, saving: false, error: message }));
      throw err;
    }
  }, []);

  // Mirror state into a ref so persist() always sees the latest values without
  // adding `state` to its dep list (would re-create the callback on every keystroke).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  return {
    values: state.values,
    loading: state.loading,
    saving: state.saving,
    error: state.error,
    setValues,
    persist,
  };
}
