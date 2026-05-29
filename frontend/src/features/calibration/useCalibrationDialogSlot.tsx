import { useCallback, useMemo } from 'react';
import CalibrationDialog from '@/component/own/CalibrationDialog';
import type { CalibrationMeasureMode } from '@/features/manualMeasure/useCalibrationManualMeasure';

type CalibrationDialogProps = React.ComponentProps<typeof CalibrationDialog>;

export type UseCalibrationDialogSlotArgs = {
  // True while the Calibration dialog is the active dialog
  // (activeDialog === 'calibration'). App still owns activeDialog.
  calibrationOpen: boolean;
  // Drives the dialog's defaultObjective auto-fill.
  activeObjective: string | null;
  // Last manual-measure pixel diagonals → auto-fill Pixel Length X / Y.
  latestManualPixels: { d1Px: number; d2Px: number } | null;

  // Calibration overlay/session wiring (App-owned, shared with other flows).
  calibrationManualModeRef: React.MutableRefObject<boolean>;
  setCalibrationMeasureMode: (next: CalibrationMeasureMode, reason: string) => void;
  setManualMeasureResetKey: React.Dispatch<React.SetStateAction<number>>;
  setAutoMeasureSessionActive: (active: boolean) => void;
  clearAutoMeasureOverlay: (reason: string) => void;
  closeDialog: () => void;
  setStatusMessage: (message: string) => void;
  refetchCalibrations: () => unknown;

  // App-owned calibration measure handlers — stay in App.tsx, passed through.
  onRequestAutoMeasure: NonNullable<CalibrationDialogProps['onRequestAutoMeasure']>;
  onRequestManualMeasure: NonNullable<CalibrationDialogProps['onRequestManualMeasure']>;
  onAutoCreateMeasurementRow: NonNullable<CalibrationDialogProps['onAutoCreateMeasurementRow']>;
};

export type UseCalibrationDialogSlotResult = {
  calibrationSlot: React.ReactElement;
};

// Builds the memoized CalibrationDialog element handed to RightPanel and wires
// the small open/close/changed callbacks tied to the calibration panel. The
// measure handlers themselves (auto/manual/auto-create-row) live in App.tsx and
// are passed in unchanged; this hook only owns the dialog composition so App
// stays slim. Keeping calibrationSlot memoized preserves RightPanel's stable
// props across unrelated App re-renders (notably machine-state pushes).
export function useCalibrationDialogSlot({
  calibrationOpen,
  activeObjective,
  latestManualPixels,
  calibrationManualModeRef,
  setCalibrationMeasureMode,
  setManualMeasureResetKey,
  setAutoMeasureSessionActive,
  clearAutoMeasureOverlay,
  closeDialog,
  setStatusMessage,
  refetchCalibrations,
  onRequestAutoMeasure,
  onRequestManualMeasure,
  onAutoCreateMeasurementRow,
}: UseCalibrationDialogSlotArgs): UseCalibrationDialogSlotResult {
  const handleDialogStatusChange = useCallback(
    (message: string) => setStatusMessage(`System Status: ${message}`),
    [setStatusMessage]
  );
  const handleCalibrationClose = useCallback(() => {
    if (calibrationManualModeRef.current) {
      calibrationManualModeRef.current = false;
    }
    setManualMeasureResetKey((current) => current + 1);
    setAutoMeasureSessionActive(false);
    clearAutoMeasureOverlay('calibration-closed');
    setCalibrationMeasureMode('none', 'panel-closed');
    closeDialog();
  }, [
    calibrationManualModeRef,
    setManualMeasureResetKey,
    setAutoMeasureSessionActive,
    clearAutoMeasureOverlay,
    setCalibrationMeasureMode,
    closeDialog,
  ]);
  const handleCalibrationChanged = useCallback(() => {
    void refetchCalibrations();
  }, [refetchCalibrations]);
  const calibrationDefaultObjective = useMemo(
    () => activeObjective || null,
    [activeObjective]
  );
  const calibrationAutoFillX = latestManualPixels?.d1Px ?? null;
  const calibrationAutoFillY = latestManualPixels?.d2Px ?? null;
  const calibrationSlot = useMemo(
    () => (
      <CalibrationDialog
        open={calibrationOpen}
        onClose={handleCalibrationClose}
        onStatusChange={handleDialogStatusChange}
        onChanged={handleCalibrationChanged}
        autoFillPixelLengthX={calibrationAutoFillX}
        autoFillPixelLengthY={calibrationAutoFillY}
        defaultObjective={calibrationDefaultObjective}
        onRequestAutoMeasure={onRequestAutoMeasure}
        onRequestManualMeasure={onRequestManualMeasure}
        onAutoCreateMeasurementRow={onAutoCreateMeasurementRow}
      />
    ),
    [
      calibrationOpen,
      handleCalibrationClose,
      handleDialogStatusChange,
      handleCalibrationChanged,
      calibrationAutoFillX,
      calibrationAutoFillY,
      calibrationDefaultObjective,
      onRequestAutoMeasure,
      onRequestManualMeasure,
      onAutoCreateMeasurementRow,
    ]
  );

  return { calibrationSlot };
}
