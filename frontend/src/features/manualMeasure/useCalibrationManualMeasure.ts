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
  calibrationManualModeRef: React.MutableRefObject<boolean>;
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

  const handleCalibrationManualMeasure = useCallback(() => {
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
