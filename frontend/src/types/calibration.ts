export type CalibrationType = 'hardness' | 'length';
export type LengthMode = 'linear' | 'plane';

export type CalibrationPayload = {
  zoomTime: string;
  force: string;
  hardnessLevel: string;
  pixelLengthX: number;
  pixelLengthY: number;
  hardness: number;
  calibrationType: CalibrationType;
  lengthMode?: LengthMode;
  realDistanceX?: number;
  realDistanceY?: number;
  createdAt: string;
};

export type CalibrationSavePayload = Omit<CalibrationPayload, 'createdAt'> & {
  createdAt?: string;
};

export type Calibration = CalibrationPayload & {
  id: string;
  updatedAt: string;
};

export type CalibrationExport = {
  exportedAt: string;
  count: number;
  items: Calibration[];
};

export type CalibrationImportPayload = {
  items: CalibrationSavePayload[];
  replace?: boolean;
};
