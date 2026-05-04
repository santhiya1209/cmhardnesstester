export const IMAGE_TYPE_OPTIONS = ['HBW-A', 'HBW-B', 'HBW-C', 'HBW-EX', 'HV-1', 'HV-2', 'HV-3'] as const;
export const OBJECTIVE_FOR_MEASURE_OPTIONS = ['10X', '20X', '40X', '50X', '100X'] as const;
export const THRESHOLD_MODE_OPTIONS = ['otsu', 'adaptive', 'manual'] as const;

export type ImageType = (typeof IMAGE_TYPE_OPTIONS)[number];
export type ObjectiveForMeasure = (typeof OBJECTIVE_FOR_MEASURE_OPTIONS)[number];
export type ThresholdMode = (typeof THRESHOLD_MODE_OPTIONS)[number];

export type AutoMeasureSettingsPayload = {
  imageType: ImageType;
  erosion: number;
  dilation: number;
  factor: number;
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
  erosion: 15,
  dilation: 10,
  factor: 6,
  erosionIterations: 1,
  dilationIterations: 1,
  morphologyKernelSize: 5,
  thresholdMode: 'otsu',
  manualThreshold: 118,
  edgeFactor: 6,
  minContourArea: 1.2,
  maxContourArea: 35,
  centerBias: 40,
  sideFitRoiWidth: 28,
  gradientStrengthFactor: 6,
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

function clampSlider(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(100, Math.round(numberOrFallback(value, fallback))));
}

function sliderToIterations(value: number): number {
  return Math.max(0, Math.min(8, Math.round(value / 12.5)));
}

function sliderToOddKernel(value: number): number {
  const kernel = Math.max(3, Math.min(15, Math.round(3 + (value / 100) * 12)));
  return kernel % 2 === 0 ? kernel + 1 : kernel;
}

export function normalizeAutoMeasureSettings(
  settings: LegacyAutoMeasureSettings | null | undefined
): AutoMeasureSettingsPayload {
  if (!settings) return DEFAULT_AUTO_MEASURE_SETTINGS;

  const erosion = clampSlider(
    settings.erosion,
    numberOrFallback(
      settings.erosionIterations,
      DEFAULT_AUTO_MEASURE_SETTINGS.erosionIterations
    ) * 12.5
  );
  const dilation = clampSlider(
    settings.dilation,
    numberOrFallback(
      settings.dilationIterations,
      DEFAULT_AUTO_MEASURE_SETTINGS.dilationIterations
    ) * 12.5
  );
  const factor = clampSlider(
    settings.factor,
    numberOrFallback(settings.edgeFactor, DEFAULT_AUTO_MEASURE_SETTINGS.factor)
  );

  return {
    ...DEFAULT_AUTO_MEASURE_SETTINGS,
    ...settings,
    erosion,
    dilation,
    factor,
    erosionIterations: sliderToIterations(erosion),
    dilationIterations: sliderToIterations(dilation),
    morphologyKernelSize: sliderToOddKernel(Math.max(erosion, dilation)),
    thresholdMode: settings.thresholdMode ?? DEFAULT_AUTO_MEASURE_SETTINGS.thresholdMode,
    manualThreshold: Math.max(
      0,
      Math.min(
        255,
        Math.round(numberOrFallback(settings.manualThreshold, DEFAULT_AUTO_MEASURE_SETTINGS.manualThreshold))
      )
    ),
    edgeFactor: factor,
    minContourArea: Math.max(
      DEFAULT_AUTO_MEASURE_SETTINGS.minContourArea,
      numberOrFallback(settings.minContourArea, DEFAULT_AUTO_MEASURE_SETTINGS.minContourArea)
    ),
    maxContourArea: Math.max(
      DEFAULT_AUTO_MEASURE_SETTINGS.maxContourArea,
      numberOrFallback(settings.maxContourArea, DEFAULT_AUTO_MEASURE_SETTINGS.maxContourArea)
    ),
    sideFitRoiWidth: Math.max(8, Math.min(70, Math.round(14 + factor * 0.45))),
    gradientStrengthFactor: factor,
  };
}
