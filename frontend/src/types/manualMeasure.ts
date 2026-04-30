import type { Point } from './tool';

export type ManualMeasureMethod = 'Manual' | 'Auto';
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
