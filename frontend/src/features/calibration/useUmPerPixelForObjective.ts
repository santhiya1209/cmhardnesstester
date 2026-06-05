import { useMemo } from 'react';
import type { Calibration } from '@/types/calibration';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import type { MachineState } from '@/types/machine';
import { resolveManualCalibration } from '@/utils/manualMeasure';

export type UseUmPerPixelForObjectiveArgs = {
  activeObjective: string | null;
  calibrationSettings: CalibrationSettings | null;
  calibrationSettingsList: CalibrationSettings[];
  calibrations: Calibration[];
  machineStore: { getSnapshot: () => MachineState | null };
  machineForce: string | number | null;
  machineHardnessLevel: string | null;
};

/**
 * um-per-pixel calibration for the currently-active objective. Resolves
 * through the same lookup helpers used by Manual Measure so Measure Length
 * renders the identical calibrated micron conversion instead of raw pixels.
 */
export function useUmPerPixelForObjective({
  activeObjective,
  calibrationSettings,
  calibrationSettingsList,
  calibrations,
  machineStore,
  machineForce,
  machineHardnessLevel,
}: UseUmPerPixelForObjectiveArgs): number | null {
  return useMemo<number | null>(() => {
    const targetObjective = (activeObjective && activeObjective.trim()) || null;
    if (!targetObjective) return null;
    const snap = machineStore.getSnapshot();
    const calibration = resolveManualCalibration({
      calibrationSettings,
      calibrationSettingsList,
      calibrations,
      machineState: snap ? { ...snap, objective: targetObjective } : null,
      targetObjective,
    });
    return calibration?.micronPerPixel ?? null;
  }, [
    activeObjective,
    calibrationSettings,
    calibrationSettingsList,
    calibrations,
    machineStore,
    machineForce,
    machineHardnessLevel,
  ]);
}
