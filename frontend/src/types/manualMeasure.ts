import type { Point } from './tool';

export type ManualMeasureMethod = 'Manual' | 'Auto' | 'Auto (Adjusted)';
export type ManualMeasureUnit = 'um' | 'px';

export type ManualMeasurePoints = [Point, Point, Point, Point];
export type ManualGuideLineKey = 'left' | 'right' | 'top' | 'bottom';

export type ManualGuideLines = {
  leftX: number;
  rightX: number;
  topY: number;
  bottomY: number;
};

export type ManualMeasureDragResult = {
  points: ManualMeasurePoints;
  d1Px: number;
  d2Px: number;
};

export type ManualMeasurementValues = {
  d1: number;
  d2: number;
  average: number;
  hv: number;
};

export type ManualDiagonalValues = Omit<ManualMeasurementValues, 'hv'>;

export type ManualCalibrationInfo = {
  micronPerPixel: number;
  // Per-axis coefficients. Populated from the legacy Calibration record's
  // realDistance/pixelLength pair (knownReferenceUm / pixelLengthX|Y). Kept
  // optional for back-compat with older callers; consumers that want spec
  // behavior should multiply per-axis instead of using the averaged value.
  micronPerPixelX?: number;
  micronPerPixelY?: number;
  calibrationName: string | null;
  objective: string | null;
};

export type ManualCalibratedValues = {
  d1Px: number;
  d2Px: number;
  d1Um: number;
  d2Um: number;
  averageUm: number;
  averageMm: number;
  hv: number | null;
};
