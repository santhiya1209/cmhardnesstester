export const IMAGE_TYPE_OPTIONS = ['HBW-A', 'HBW-B', 'HBW-C', 'HBW-EX', 'HV-1', 'HV-2', 'HV-3'] as const;
export const OBJECTIVE_FOR_MEASURE_OPTIONS = ['10X', '40X'] as const;

// Machine-tuned per-objective defaults for the Auto Measure pipeline.
// Mirrored in App.tsx detection paths so the values stay in lockstep when the
// active objective changes (machine-confirmed or PC-driven).
export const AUTO_MEASURE_DEFAULTS_BY_OBJECTIVE: Record<
  '10X' | '40X',
  { smoothing: number; threshold: number }
> = {
  '10X': { smoothing: 4, threshold: 44 },
  '40X': { smoothing: 6, threshold: 91 },
};
export const THRESHOLD_MODE_OPTIONS = ['otsu', 'adaptive', 'manual'] as const;

export const SMOOTHING_MIN = 0;
export const SMOOTHING_MAX = 20;
export const THRESHOLD_MIN = 0;
export const THRESHOLD_MAX = 255;

export type ImageType = (typeof IMAGE_TYPE_OPTIONS)[number];
export type ObjectiveForMeasure = (typeof OBJECTIVE_FOR_MEASURE_OPTIONS)[number];
export type ThresholdMode = (typeof THRESHOLD_MODE_OPTIONS)[number];

export type AutoMeasureSettingsPayload = {
  smoothing: number;
  threshold: number;
  turretAfterImpress: boolean;
  measureAfterImpress: boolean;
  objectiveForMeasure: ObjectiveForMeasure;
  // Derived (kept so the existing native bridge / pipeline keeps working without
  // a wider refactor). UI never edits these directly.
  imageType: ImageType;
  thresholdMode: ThresholdMode;
  manualThreshold: number;
  morphologyKernelSize: number;
};

export type AutoMeasureSettings = AutoMeasureSettingsPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_AUTO_MEASURE_SETTINGS: AutoMeasureSettingsPayload = {
  smoothing: 15,
  threshold: 134,
  turretAfterImpress: true,
  measureAfterImpress: true,
  objectiveForMeasure: '40X',
  imageType: 'HV-2',
  thresholdMode: 'manual',
  manualThreshold: 134,
  morphologyKernelSize: 11,
};

type LegacyAutoMeasureSettings = Partial<AutoMeasureSettingsPayload> & {
  // tolerated on input only
  erosion?: number;
  dilation?: number;
  factor?: number;
  edgeFactor?: number;
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function smoothingToKernel(smoothing: number): number {
  if (smoothing <= 0) return 1;
  const bucket = Math.min(5, Math.max(1, Math.ceil(smoothing / 4)));
  return bucket * 2 + 1;
}

function isObjective(value: unknown): value is ObjectiveForMeasure {
  return (
    typeof value === 'string' &&
    (OBJECTIVE_FOR_MEASURE_OPTIONS as readonly string[]).includes(value)
  );
}

export function normalizeAutoMeasureSettings(
  settings: LegacyAutoMeasureSettings | null | undefined
): AutoMeasureSettingsPayload {
  if (!settings) return DEFAULT_AUTO_MEASURE_SETTINGS;

  const smoothing = clampNumber(
    settings.smoothing,
    SMOOTHING_MIN,
    SMOOTHING_MAX,
    DEFAULT_AUTO_MEASURE_SETTINGS.smoothing
  );
  const threshold = clampNumber(
    settings.threshold ?? settings.manualThreshold,
    THRESHOLD_MIN,
    THRESHOLD_MAX,
    DEFAULT_AUTO_MEASURE_SETTINGS.threshold
  );

  return {
    smoothing,
    threshold,
    turretAfterImpress:
      typeof settings.turretAfterImpress === 'boolean'
        ? settings.turretAfterImpress
        : DEFAULT_AUTO_MEASURE_SETTINGS.turretAfterImpress,
    measureAfterImpress:
      typeof settings.measureAfterImpress === 'boolean'
        ? settings.measureAfterImpress
        : DEFAULT_AUTO_MEASURE_SETTINGS.measureAfterImpress,
    objectiveForMeasure: isObjective(settings.objectiveForMeasure)
      ? settings.objectiveForMeasure
      : DEFAULT_AUTO_MEASURE_SETTINGS.objectiveForMeasure,
    imageType: DEFAULT_AUTO_MEASURE_SETTINGS.imageType,
    thresholdMode: 'manual',
    manualThreshold: threshold,
    morphologyKernelSize: smoothingToKernel(smoothing),
  };
}
