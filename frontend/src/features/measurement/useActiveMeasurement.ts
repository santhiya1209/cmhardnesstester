import { useCallback, useRef } from 'react';

export type ActiveMeasurementApi = {
  activeMeasurementIdRef: React.MutableRefObject<string | null>;
  activeMeasurementFrameIdRef: React.MutableRefObject<number | null>;
  activeMeasurementMethodRef: React.MutableRefObject<string | null>;
  cameraMeasurementSessionIdRef: React.MutableRefObject<number>;
  getActiveMeasurementId: () => string | undefined;
  setActiveMeasurement: (id: string, frameId: number | null, reason: string) => void;
  clearActiveMeasurement: (reason: string) => void;
};

// Frame-anchored active measurement bookkeeping. The single row currently
// "owned" by the frozen frame the user is interacting with — Auto Measure,
// Manual Measure, line drag, and Calibration all consult these so they update
// the same row instead of creating duplicates. activeMeasurementMethodRef is
// also written directly by save call sites so they can emit honest
// [measurement-mode-update] logs without re-reading the table.
// cameraMeasurementSessionIdRef is bumped on every camera open / cleared on
// close — its only role is to scope the "one active row per session" rule.
export function useActiveMeasurement(): ActiveMeasurementApi {
  const activeMeasurementIdRef = useRef<string | null>(null);
  const activeMeasurementFrameIdRef = useRef<number | null>(null);
  const activeMeasurementMethodRef = useRef<string | null>(null);
  const cameraMeasurementSessionIdRef = useRef<number>(0);

  // Returns the current active row id, regardless of which live frame is
  // painted. The earlier strict-frame-id gate was buggy: while the user holds
  // a frozen Auto Measure result and opens Calibration, the live camera keeps
  // painting new frame ids, so getLastPaintedFrameId() drifts away from the
  // frame the row was tagged with — and reuse fell through to POST, creating
  // duplicate rows. The active id is invalidated ONLY by the explicit "new
  // measurement" boundaries (new image, camera close, clear table,
  // clear-graphics).
  const getActiveMeasurementId = useCallback((): string | undefined => {
    const id = activeMeasurementIdRef.current ?? undefined;
    if (id) {
    }
    return id;
  }, []);

  const setActiveMeasurement = useCallback(
    (id: string, frameId: number | null, _reason: string) => {
      activeMeasurementIdRef.current = id;
      activeMeasurementFrameIdRef.current = frameId;
    },
    []
  );

  const clearActiveMeasurement = useCallback((_reason: string) => {
    if (
      activeMeasurementIdRef.current === null &&
      activeMeasurementFrameIdRef.current === null &&
      activeMeasurementMethodRef.current === null
    ) {
      return;
    }
    activeMeasurementIdRef.current = null;
    activeMeasurementFrameIdRef.current = null;
    activeMeasurementMethodRef.current = null;
  }, []);

  return {
    activeMeasurementIdRef,
    activeMeasurementFrameIdRef,
    activeMeasurementMethodRef,
    cameraMeasurementSessionIdRef,
    getActiveMeasurementId,
    setActiveMeasurement,
    clearActiveMeasurement,
  };
}
