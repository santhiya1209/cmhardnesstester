import type { Calibration } from '@/types/calibration';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import type { MachineState } from '@/types/machine';
import { parseForceKgf, resolveManualCalibration } from '@/utils/manualMeasure';
import type { AutoMeasureCallSource } from './autoMeasureHelpers';

type CalibrationInfo = NonNullable<ReturnType<typeof resolveManualCalibration>>;

export type ResolveAutoMeasureCalibrationArgs = {
  machineState: MachineState | null;
  objectiveForCalibration: string;
  calibrationSettings: CalibrationSettings | null;
  calibrationSettingsList: CalibrationSettings[];
  calibrations: Calibration[];
  callSource: AutoMeasureCallSource;
};

export type ResolveAutoMeasureCalibrationResult = {
  machineStateForAuto: MachineState | null;
  calibration: CalibrationInfo | null;
  forceKgf: number | null;
};

export function resolveAutoMeasureCalibration({
  machineState,
  objectiveForCalibration,
  calibrationSettings,
  calibrationSettingsList,
  calibrations,
  callSource,
}: ResolveAutoMeasureCalibrationArgs): ResolveAutoMeasureCalibrationResult {
  const machineStateForAuto = machineState
    ? { ...machineState, objective: objectiveForCalibration }
    : null;
  const calibration = resolveManualCalibration({
    calibrationSettings,
    calibrations,
    machineState: machineStateForAuto,
    targetObjective: objectiveForCalibration,
    calibrationSettingsList,
  });
  if (callSource === 'auto-click') {
    // eslint-disable-next-line no-console
    console.warn(
      `[auto-measure-scale] objective=${objectiveForCalibration ?? 'null'} pxToUm=${calibration?.micronPerPixel ?? 'null'} calibration=${calibration?.calibrationName ?? 'null'}`
    );
  }
  const forceKgf = parseForceKgf(machineState?.force);
  return { machineStateForAuto, calibration, forceKgf };
}
