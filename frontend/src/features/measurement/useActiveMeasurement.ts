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

export function useActiveMeasurement(): ActiveMeasurementApi {
  const activeMeasurementIdRef = useRef<string | null>(null);
  const activeMeasurementFrameIdRef = useRef<number | null>(null);
  const activeMeasurementMethodRef = useRef<string | null>(null);
  const cameraMeasurementSessionIdRef = useRef<number>(0);

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
