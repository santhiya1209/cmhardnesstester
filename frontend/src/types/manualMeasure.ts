import type { Point } from './tool';

export type ManualMeasureMethod = 'Manual' | 'Auto';

export type ManualMeasurePoints = [Point, Point, Point, Point];

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
