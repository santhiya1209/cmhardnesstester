export const IMAGE_TYPE_OPTIONS = ['HV-1', 'HV-2', 'HV-3'] as const;
export const OBJECTIVE_FOR_MEASURE_OPTIONS = ['10X', '40X'] as const;
export const THRESHOLD_MODE_OPTIONS = ['otsu', 'adaptive', 'manual'] as const;

export type ImageType = (typeof IMAGE_TYPE_OPTIONS)[number];
export type ObjectiveForMeasure = (typeof OBJECTIVE_FOR_MEASURE_OPTIONS)[number];
export type ThresholdMode = (typeof THRESHOLD_MODE_OPTIONS)[number];

export type AutoMeasureSettingsPayload = {
  imageType: ImageType;
  erosionIterations: number;
  dilationIterations: number;
  morphologyKernelSize: number;
  thresholdMode: ThresholdMode;
  manualThreshold: number;
  edgeFactor: number;
  minContourArea: number;
  maxContourArea: number;
  centerBias: number;
  sideFitRoiWidth: number;
  gradientStrengthFactor: number;
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
  erosionIterations: 1,
  dilationIterations: 1,
  morphologyKernelSize: 5,
  thresholdMode: 'otsu',
  manualThreshold: 118,
  edgeFactor: 38,
  minContourArea: 0.004,
  maxContourArea: 24,
  centerBias: 40,
  sideFitRoiWidth: 28,
  gradientStrengthFactor: 36,
  turretAfterImpress: true,
  measureAfterImpress: true,
  objectiveForMeasure: '40X',
};

type LegacyAutoMeasureSettings = Partial<AutoMeasureSettingsPayload> & {
  erosion?: number;
  dilation?: number;
  factor?: number;
};

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeAutoMeasureSettings(
  settings: LegacyAutoMeasureSettings | null | undefined
): AutoMeasureSettingsPayload {
  if (!settings) return DEFAULT_AUTO_MEASURE_SETTINGS;

  return {
    ...DEFAULT_AUTO_MEASURE_SETTINGS,
    ...settings,
    erosionIterations: numberOrFallback(
      settings.erosionIterations,
      numberOrFallback(settings.erosion, DEFAULT_AUTO_MEASURE_SETTINGS.erosionIterations)
    ),
    dilationIterations: numberOrFallback(
      settings.dilationIterations,
      numberOrFallback(settings.dilation, DEFAULT_AUTO_MEASURE_SETTINGS.dilationIterations)
    ),
    edgeFactor: numberOrFallback(
      settings.edgeFactor,
      numberOrFallback(settings.factor, DEFAULT_AUTO_MEASURE_SETTINGS.edgeFactor)
    ),
  };
}
