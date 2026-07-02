import { useMemo } from 'react';
import { useMachineSelector } from '@/contexts/MachineStateContext';
import { useGetCalibrationsQuery } from '@/store/api/calibrationApi';
import { useCalibrationSettings } from '@/hooks/queries/useCalibrationSettings';
import type { MachineState } from '@/types/machine';
import { resolveActiveCalibration } from '@/utils/manualMeasure';

export type ActiveCalibrationDisplay = {
  status: 'calibrated' | 'not-calibrated';
  calibrationId: string | null;
  objective: string | null;
  force: string | null;
  certifiedHardnessHv: number | null;
  calibrationName: string | null;
  calibratedAt: string | null;
  micronPerPixel: number | null;
};

/**
 * The active calibration for the given objective, resolved through the single
 * calibration resolver used by Manual Measure, Auto Measure, and Measure
 * Length — the display can therefore never disagree with the calibration a
 * measurement will use. 'calibrated' requires a record matching the active
 * objective + force.
 */
export function useActiveCalibration(activeObjective: string | null): ActiveCalibrationDisplay {
  const { data: calibrations = [] } = useGetCalibrationsQuery();
  const { data: calibrationSettings, items: calibrationSettingsList } = useCalibrationSettings();
  const connected = useMachineSelector((s) => s !== null);
  const force = useMachineSelector((s) => s?.force ?? null);
  const hardnessLevel = useMachineSelector((s) => s?.hardnessLevel ?? null);

  return useMemo<ActiveCalibrationDisplay>(() => {
    const targetObjective = activeObjective?.trim() || null;
    const resolution = resolveActiveCalibration({
      calibrations,
      calibrationSettings,
      calibrationSettingsList,
      machineState: connected ? ({ force, hardnessLevel } as MachineState) : null,
      objective: targetObjective,
    });
    if (resolution.status !== 'calibrated') {
      return {
        status: 'not-calibrated',
        calibrationId: null,
        objective: targetObjective,
        force: force != null ? String(force) : null,
        certifiedHardnessHv: null,
        calibrationName: null,
        calibratedAt: null,
        micronPerPixel: null,
      };
    }
    const calibration = resolution.calibration;
    return {
      status: 'calibrated',
      calibrationId: calibration.calibrationId,
      objective: calibration.objective,
      force: calibration.force,
      certifiedHardnessHv: calibration.certifiedHardnessHv,
      calibrationName: calibration.calibrationName,
      calibratedAt: calibration.calibratedAt,
      micronPerPixel: calibration.micronPerPixel,
    };
  }, [
    activeObjective,
    calibrations,
    calibrationSettings,
    calibrationSettingsList,
    connected,
    force,
    hardnessLevel,
  ]);
}
