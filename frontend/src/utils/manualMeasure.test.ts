import { describe, expect, it } from 'vitest';
import { resolveManualCalibration } from './manualMeasure';
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
