import { describe, expect, it } from 'vitest';
import {
  calculateVickersFromPixels,
  cornersToDiagonalsPx,
  distancePx,
  guideLinesToPoints,
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

// The industrial invariant: for the SAME four indentation corners, Manual and
// Auto Measure must produce the SAME D1/D2/HV. Manual derives its diagonals from
// axis-aligned guide lines (guideLinesToPoints → distancePx); Auto derives them
// from detected corners (cornersToDiagonalsPx). Both then feed the SINGLE shared
// engine calculateVickersFromPixels. This test freezes that guarantee so no
// future change can reintroduce a mode-specific diagonal or HV path.
describe('Manual and Auto share one measurement engine for identical corners', () => {
  const cal = calibration({
    id: 'cal-40x-1kgf',
    force: '1kgf',
    realDistanceX: 40,
    realDistanceY: 40, // 40/100 = 0.4 µm/px
  });

  // One indentation, expressed as the four axis-aligned corners both modes agree on.
  const corners = {
    top: { x: 250, y: 120 },
    right: { x: 400, y: 250 },
    bottom: { x: 250, y: 380 },
    left: { x: 100, y: 250 },
  };
  const guides = { leftX: 100, rightX: 400, topY: 120, bottomY: 380 };

  it('derives identical D1/D2 pixels from both corner representations', () => {
    const manualPoints = guideLinesToPoints(guides);
    const manualD1 = distancePx(manualPoints[1], manualPoints[3]);
    const manualD2 = distancePx(manualPoints[0], manualPoints[2]);
    const auto = cornersToDiagonalsPx(corners);

    expect(manualD1).toBe(auto.d1Px);
    expect(manualD2).toBe(auto.d2Px);
    expect(manualD1).toBe(300);
    expect(manualD2).toBe(260);
  });

  it('produces the same HV for the same corners through the shared engine', () => {
    const manualPoints = guideLinesToPoints(guides);
    const args = {
      calibrationSettings: null,
      calibrations: [cal],
      machineState: machine('1kgf'),
      forceKgf: 1,
      objective: '40X',
      targetObjective: '40X',
    };

    const manual = calculateVickersFromPixels({
      ...args,
      d1Px: distancePx(manualPoints[1], manualPoints[3]),
      d2Px: distancePx(manualPoints[0], manualPoints[2]),
    });
    const auto = calculateVickersFromPixels({
      ...args,
      ...cornersToDiagonalsPx(corners),
    });

    expect(manual.ok).toBe(true);
    expect(auto.ok).toBe(true);
    if (!manual.ok || !auto.ok) return;
    expect(manual.value.d1Um).toBe(auto.value.d1Um);
    expect(manual.value.d2Um).toBe(auto.value.d2Um);
    expect(manual.value.avgDMm).toBe(auto.value.avgDMm);
    expect(manual.value.hv).toBe(auto.value.hv);
    expect(manual.value.calibrationId).toBe(auto.value.calibrationId);
  });

  // Auto→Manual handoff: CameraWindow seeds Manual's guide lines from the Auto
  // corners as { leftX: left.x, rightX: right.x, topY: top.y, bottomY: bottom.y }.
  // This must reproduce Auto's exact d1Px/d2Px even for a slightly tilted detected
  // diamond, so opening Manual right after Auto — without moving a point — yields
  // the identical measurement. Uses off-axis corners to prove the seed keeps the
  // real corner coordinates, not a re-centered box.
  it('seed guides built from Auto corners reproduce Auto D1/D2 exactly', () => {
    const detected = {
      top: { x: 252, y: 118 },
      right: { x: 401, y: 249 },
      bottom: { x: 248, y: 383 },
      left: { x: 99, y: 251 },
    };
    const seedGuides = {
      leftX: detected.left.x,
      rightX: detected.right.x,
      topY: detected.top.y,
      bottomY: detected.bottom.y,
    };
    const seededPoints = guideLinesToPoints(seedGuides);
    const seededD1 = distancePx(seededPoints[1], seededPoints[3]);
    const seededD2 = distancePx(seededPoints[0], seededPoints[2]);
    const auto = cornersToDiagonalsPx(detected);

    expect(seededD1).toBe(auto.d1Px);
    expect(seededD2).toBe(auto.d2Px);
  });
});
