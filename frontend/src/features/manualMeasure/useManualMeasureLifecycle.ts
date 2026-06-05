import { useCallback, useEffect, useRef, useState } from 'react';

type ManualPixels = { d1Px: number; d2Px: number };

export interface ManualMeasureLifecycle {
  manualMeasurementIdRef: React.MutableRefObject<string | null>;
  manualMeasureResetKey: number;
  setManualMeasureResetKey: React.Dispatch<React.SetStateAction<number>>;
  latestManualPixels: ManualPixels | null;
  setLatestManualPixels: React.Dispatch<React.SetStateAction<ManualPixels | null>>;
  latestManualPixelsRef: React.MutableRefObject<ManualPixels | null>;
  resetManualMeasure: () => void;
}

export function useManualMeasureLifecycle(): ManualMeasureLifecycle {
  const manualMeasurementIdRef = useRef<string | null>(null);
  const [manualMeasureResetKey, setManualMeasureResetKey] = useState(0);
  const [latestManualPixels, setLatestManualPixels] = useState<ManualPixels | null>(null);
  const latestManualPixelsRef = useRef<ManualPixels | null>(null);

  useEffect(() => {
    latestManualPixelsRef.current = latestManualPixels;
  }, [latestManualPixels]);

  const resetManualMeasure = useCallback(() => {
    manualMeasurementIdRef.current = null;
    setManualMeasureResetKey((current) => current + 1);
  }, []);

  return {
    manualMeasurementIdRef,
    manualMeasureResetKey,
    setManualMeasureResetKey,
    latestManualPixels,
    setLatestManualPixels,
    latestManualPixelsRef,
    resetManualMeasure,
  };
}
