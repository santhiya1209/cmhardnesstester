import type { ManualMeasureMethod, ManualMeasureUnit } from './manualMeasure';

export type MeasurementPayload = {
  d1: number;
  d2: number;
  hv: number | null;
  depthMm: number | null;
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
  objective: string | null;
  testForceKgf: number | null;
  timestamp: string;
  imageDataUrl?: string;
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
  objective?: string | null;
  testForceKgf?: number | null;
  timestamp?: string;
};

export type Measurement = MeasurementPayload & {
  id: string;
  average: number;
  createdAt: string;
  updatedAt: string;
};
