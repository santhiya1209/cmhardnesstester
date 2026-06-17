import type { ManualMeasureMethod, ManualMeasureUnit } from './manualMeasure';

export type DepthSource = 'device' | 'manual';

// Indentation diamond vertices, NORMALISED to 0..1 of the captured frame, so the
// vector overlay can be repainted sharp on a later point review at any display
// size (the saved still is a downscaled thumbnail). See App.reviewMultipointPoint.
export type DiamondGeometry = {
  top: { x: number; y: number };
  right: { x: number; y: number };
  bottom: { x: number; y: number };
  left: { x: number; y: number };
};

export type MeasurementPayload = {
  d1: number;
  d2: number;
  hv: number | null;
  depthMm: number | null;
  depthSource?: DepthSource | null;
  deviceDepthMm?: number | null;
  manualDepthMm?: number | null;
  method: ManualMeasureMethod;
  unit: ManualMeasureUnit;
  d1Px: number | null;
  d2Px: number | null;
  d1Um: number | null;
  d2Um: number | null;
  averageUm: number | null;
  averageMm: number | null;
  micronPerPixel: number | null;
  calibrationName: string | null;
  calibrationId: string | null;
  objective: string | null;
  testForceKgf: number | null;
  timestamp: string;
  imageDataUrl?: string;
  diamond?: DiamondGeometry | null;
  xMm?: number | null;
  yMm?: number | null;
  hardnessType?: string | null;
  qualified?: string | null;
  convertType?: string | null;
  convertValue?: number | string | null;
};

export type MeasurementSavePayload = {
  d1: number;
  d2: number;
  hv?: number | null;
  depthMm?: number | null;
  depthSource?: DepthSource | null;
  deviceDepthMm?: number | null;
  manualDepthMm?: number | null;
  method?: ManualMeasureMethod;
  unit?: ManualMeasureUnit;
  d1Px?: number | null;
  d2Px?: number | null;
  d1Um?: number | null;
  d2Um?: number | null;
  averageUm?: number | null;
  averageMm?: number | null;
  micronPerPixel?: number | null;
  calibrationName?: string | null;
  calibrationId?: string | null;
  objective?: string | null;
  testForceKgf?: number | null;
  timestamp?: string;
  imageDataUrl?: string;
  diamond?: DiamondGeometry | null;
  qualified?: 'YES' | 'NO' | null;
  hardnessType?: string | null;
  convertType?: string | null;
  convertValue?: number | null;
};

export type Measurement = MeasurementPayload & {
  id: string;
  average: number;
  createdAt: string;
  updatedAt: string;
};
