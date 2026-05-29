import { useCallback, useRef, useState } from 'react';
import type { ToolId } from '@/types/tool';

export type CalibrationMeasureMode = 'none' | 'auto' | 'manual';

export interface UseCalibrationManualMeasureInput {
  clearAutoMeasureOverlay: (reason: string) => void;
  setActiveTool: (tool: ToolId) => void;
  setAutoMeasureSessionActive: (active: boolean) => void;
  setStatusMessage: (message: string) => void;
}

export interface CalibrationManualMeasureApi {
  // True while the user is doing a Manual Measure that was launched from the
  // Calibration dialog. handleManualMeasurementUpdated checks this flag so it
  // can suppress measurement-row creation (calibration mode is pixels-only)
  // and the calibration dialog re-opens once the user is done.
  calibrationManualModeRef: React.MutableRefObject<boolean>;
  // Mutually-exclusive overlay mode for the Calibration panel. Without this
  // the shared AutoMeasureOverlay and ManualMeasureOverlay state could both
  // be populated while Calibration is open — clicking Auto, then Manual,
  // would leave the yellow auto guides visible underneath the manual
  // draggable lines. Updated only from the three calibration entry points
  // (auto click, manual click, dialog close).
  calibrationMeasureModeRef: React.MutableRefObject<CalibrationMeasureMode>;
  setCalibrationMeasureMode: (next: CalibrationMeasureMode, reason: string) => void;
  handleCalibrationManualMeasure: () => void;
}

export function useCalibrationManualMeasure(
  input: UseCalibrationManualMeasureInput
): CalibrationManualMeasureApi {
  const {
    clearAutoMeasureOverlay,
    setActiveTool,
    setAutoMeasureSessionActive,
    setStatusMessage,
  } = input;

  const calibrationManualModeRef = useRef(false);
  const [, setCalibrationMeasureModeState] = useState<CalibrationMeasureMode>('none');
  const calibrationMeasureModeRef = useRef<CalibrationMeasureMode>('none');

  const setCalibrationMeasureMode = useCallback(
    (next: CalibrationMeasureMode, _reason: string) => {
      const prev = calibrationMeasureModeRef.current;
      if (prev === next) return;
      calibrationMeasureModeRef.current = next;
      setCalibrationMeasureModeState(next);
    },
    []
  );

  // Calibration-mode Manual Measure: activates the manual measure tool while
  // keeping the calibration PANEL open (panel layout, not modal). The user
  // drags the cross over the indent on the live image; each drag updates
  // latestManualPixels (and emits [calibration-drag-update]); the panel's
  // live-update effect syncs Pixel Length X / Y in real time. The flag
  // suppresses measurement-row creation so the calibration drag does not
  // pollute the measurement table.
  const handleCalibrationManualMeasure = useCallback(() => {
    // Mutually-exclusive calibration overlay: clear any auto state before
    // entering manual mode so the yellow auto guides disappear immediately.
    if (calibrationMeasureModeRef.current === 'auto') {
    }
    setAutoMeasureSessionActive(false);
    clearAutoMeasureOverlay('switch-to-manual');
    setCalibrationMeasureMode('manual', 'manual-measure-click');
    calibrationManualModeRef.current = true;
    setActiveTool('manualMeasure');
    setStatusMessage(
      'System Status: Calibration Manual Measure active: drag the cross over the indent. Pixel X/Y update live in the panel.'
    );
  }, [
    clearAutoMeasureOverlay,
    setActiveTool,
    setAutoMeasureSessionActive,
    setCalibrationMeasureMode,
    setStatusMessage,
  ]);

  return {
    calibrationManualModeRef,
    calibrationMeasureModeRef,
    setCalibrationMeasureMode,
    handleCalibrationManualMeasure,
  };
}
