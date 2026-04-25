export const IMAGE_TYPE_OPTIONS = ['HV-1', 'HV-2', 'HV-3'] as const;
export const OBJECTIVE_FOR_MEASURE_OPTIONS = ['10X', '40X'] as const;

export type ImageType = (typeof IMAGE_TYPE_OPTIONS)[number];
export type ObjectiveForMeasure = (typeof OBJECTIVE_FOR_MEASURE_OPTIONS)[number];

export type AutoMeasureSettingsPayload = {
  imageType: ImageType;
  erosion: number;
  dilation: number;
  factor: number;
  turretAfterImpress: boolean;
  measureAfterImpress: boolean;
  objectiveForMeasure: ObjectiveForMeasure;
};

export type AutoMeasureSettings = AutoMeasureSettingsPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_AUTO_MEASURE_SETTINGS: AutoMeasureSettingsPayload = {
  imageType: 'HV-2',
  erosion: 15,
  dilation: 10,
  factor: 6,
  turretAfterImpress: true,
  measureAfterImpress: true,
  objectiveForMeasure: '40X',
};
