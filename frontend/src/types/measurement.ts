import type { ManualMeasureMethod } from './manualMeasure';

export type MeasurementPayload = {
  d1: number;
  d2: number;
  hv: number;
  method: ManualMeasureMethod;
  timestamp: string;
};

export type MeasurementSavePayload = {
  d1: number;
  d2: number;
  hv: number;
  method?: ManualMeasureMethod;
  timestamp?: string;
};

export type Measurement = MeasurementPayload & {
  id: string;
  average: number;
  createdAt: string;
  updatedAt: string;
};
