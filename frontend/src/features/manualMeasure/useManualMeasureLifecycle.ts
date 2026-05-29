import { useCallback, useEffect, useRef, useState } from 'react';

type ManualPixels = { d1Px: number; d2Px: number };

export interface ManualMeasureLifecycle {
  manualMeasurementIdRef: React.MutableRefObject<string | null>;
  manualMeasureResetKey: number;
  setManualMeasureResetKey: React.Dispatch<React.SetStateAction<number>>;
  // Last manual-measure pixel diagonals (d1Px = horizontal, d2Px = vertical).
  // Captured in handleManualMeasurementUpdated and passed to CalibrationDialog
  // so opening the dialog auto-fills Pixel Length X / Y. State (not ref) so
  // the dialog re-renders with fresh values when re-opened.
  latestManualPixels: ManualPixels | null;
  setLatestManualPixels: React.Dispatch<React.SetStateAction<ManualPixels | null>>;
  // Mirror of latestManualPixels for synchronous reads from async callbacks
  // (e.g. the auto-measure preview result handler, which needs to compute a
  // geometry delta vs. the previous pixels without closing over stale state).
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
