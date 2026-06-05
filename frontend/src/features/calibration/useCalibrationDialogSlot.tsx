import { useCallback, useMemo } from 'react';
import CalibrationDialog from '@/component/own/CalibrationDialog';
import type { CalibrationMeasureMode } from '@/features/manualMeasure/useCalibrationManualMeasure';

type CalibrationDialogProps = React.ComponentProps<typeof CalibrationDialog>;

export type UseCalibrationDialogSlotArgs = {
  calibrationOpen: boolean;
  activeObjective: string | null;
  latestManualPixels: { d1Px: number; d2Px: number } | null;

  calibrationManualModeRef: React.MutableRefObject<boolean>;
  setCalibrationMeasureMode: (next: CalibrationMeasureMode, reason: string) => void;
  setManualMeasureResetKey: React.Dispatch<React.SetStateAction<number>>;
  setAutoMeasureSessionActive: (active: boolean) => void;
  clearAutoMeasureOverlay: (reason: string) => void;
  closeDialog: () => void;
  setStatusMessage: (message: string) => void;
  refetchCalibrations: () => unknown;

  onRequestAutoMeasure: NonNullable<CalibrationDialogProps['onRequestAutoMeasure']>;
  onRequestManualMeasure: NonNullable<CalibrationDialogProps['onRequestManualMeasure']>;
  onAutoCreateMeasurementRow: NonNullable<CalibrationDialogProps['onAutoCreateMeasurementRow']>;
};

export type UseCalibrationDialogSlotResult = {
  calibrationSlot: React.ReactElement;
};

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
