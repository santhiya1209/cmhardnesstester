import { describe, expect, it } from 'vitest';
import {
  calculateVickersFromPixels,
  resolveActiveCalibration,
  resolveManualCalibration,
} from './manualMeasure';
import type { Calibration } from '@/types/calibration';
import type { MachineState } from '@/types/machine';

function calibration(overrides: Partial<Calibration>): Calibration {
  return {
    id: overrides.id ?? overrides.force ?? 'id',
    zoomTime: '40X',
    force: '1kgf',
    hardnessLevel: 'Middle',
    pixelLengthX: 100,
    pixelLengthY: 100,
    hardness: 747,
    calibrationType: 'hardness',
    realDistanceX: 40,
    realDistanceY: 40,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  } as Calibration;
}

function machine(force: string): MachineState {
  return {
    objective: '40X',
    force,
    hardnessLevel: 'Middle',
  } as MachineState;
}

describe('resolveManualCalibration force-aware restoration', () => {
  // Two forces calibrated for the SAME objective. The 0.3kgf row is the most
  // recently created. Before the fix the objective-only lookup always returned
  // the newest row, so every force resolved to the 0.3kgf calibration.
  const force1kgf = calibration({
    id: '1kgf',
    force: '1kgf',
    realDistanceX: 40,
    realDistanceY: 40, // 40/100 = 0.4 µm/px
    createdAt: '2026-06-10T00:00:00.000Z',
  });
  const force03kgf = calibration({
    id: '0.3kgf',
    force: '0.3kgf',
    realDistanceX: 20,
    realDistanceY: 20, // 20/100 = 0.2 µm/px
    createdAt: '2026-06-12T00:00:00.000Z',
  });
  const calibrations = [force1kgf, force03kgf];

  it('resolves the calibration saved for the selected force', () => {
    const result = resolveManualCalibration({
      calibrationSettings: null,
      calibrations,
      machineState: machine('1kgf'),
      targetObjective: '40X',
    });
    expect(result?.micronPerPixel).toBeCloseTo(0.4, 5);
  });

  it('resolves a different force to its own calibration', () => {
    const result = resolveManualCalibration({
      calibrationSettings: null,
      calibrations,
      machineState: machine('0.3kgf'),
      targetObjective: '40X',
    });
    expect(result?.micronPerPixel).toBeCloseTo(0.2, 5);
  });

  it('falls back to the most-recent row when the force has no calibration', () => {
    const result = resolveManualCalibration({
      calibrationSettings: null,
      calibrations,
      machineState: machine('0.5kgf'),
      targetObjective: '40X',
    });
    // 0.5kgf is uncalibrated → newest row (0.3kgf) is still resolved.
    expect(result?.micronPerPixel).toBeCloseTo(0.2, 5);
  });
});

describe('resolveActiveCalibration (status display)', () => {
  const cal = calibration({
    id: 'cal-40x-1kgf',
    force: '1kgf',
    hardness: 747,
    realDistanceX: 40,
    realDistanceY: 40, // 40/100 = 0.4 µm/px
  });

  it('surfaces the resolved calibration for the active objective + force', () => {
    const result = resolveActiveCalibration({
      calibrations: [cal],
      machineState: machine('1kgf'),
      objective: '40X',
    });
    expect(result.status).toBe('calibrated');
    if (result.status !== 'calibrated') return;
    expect(result.calibration.objective).toBe('40X');
    expect(result.calibration.force).toBe('1kgf');
    expect(result.calibration.calibrationId).toBe('cal-40x-1kgf');
    expect(result.calibration.certifiedHardnessHv).toBe(747);
    expect(result.calibration.micronPerPixel).toBeCloseTo(0.4, 5);
  });

  it('reports not-calibrated when no calibration exists for the objective', () => {
    const result = resolveActiveCalibration({
      calibrations: [cal],
      machineState: machine('1kgf'),
      objective: '10X',
    });
    expect(result.status).toBe('not-calibrated');
  });

  it('resolves the same micron scale the measurement pipeline applies', () => {
    const display = resolveActiveCalibration({
      calibrations: [cal],
      machineState: machine('1kgf'),
      objective: '40X',
    });
    const measured = calculateVickersFromPixels({
      calibrationSettings: null,
      calibrations: [cal],
      machineState: { objective: '40X', force: '1kgf', hardnessLevel: 'Middle' } as MachineState,
      d1Px: 100,
      d2Px: 100,
      forceKgf: 1,
      objective: '40X',
      targetObjective: '40X',
    });
    expect(display.status).toBe('calibrated');
    expect(measured.ok).toBe(true);
    if (display.status !== 'calibrated' || !measured.ok) return;
    // The display can never disagree with the scale a measurement applies.
    expect(display.calibration.micronPerPixel).toBeCloseTo(measured.value.umPerPixel, 6);
  });
});
