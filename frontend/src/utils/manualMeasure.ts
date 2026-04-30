import type { Calibration } from '@/types/calibration';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import type { MachineState } from '@/types/machine';
import type {
  ManualCalibratedValues,
  ManualCalibrationInfo,
  ManualDiagonalValues,
  ManualGuideLines,
  ManualMeasurementValues,
  ManualMeasurePoints,
} from '@/types/manualMeasure';
import type { Point } from '@/types/tool';

type ImageSize = {
  width: number;
  height: number;
};

type ImagePlacement = {
  offsetX: number;
  offsetY: number;
  scale: number;
  width: number;
  height: number;
};

type ResolveMicronsPerPixelArgs = {
  calibrationSettings: CalibrationSettings | null;
  calibrations: Calibration[];
  machineState?: MachineState | null;
};

const VICKERS_CONSTANT = 1.8544;

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

export function distancePx(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function getImagePlacement(
  containerWidth: number,
  containerHeight: number,
  imageSize: ImageSize
): ImagePlacement | null {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    imageSize.width <= 0 ||
    imageSize.height <= 0
  ) {
    return null;
  }

  const scale = Math.min(
    containerWidth / imageSize.width,
    containerHeight / imageSize.height
  );
  const width = imageSize.width * scale;
  const height = imageSize.height * scale;

  return {
    offsetX: (containerWidth - width) / 2,
    offsetY: (containerHeight - height) / 2,
    scale,
    width,
    height,
  };
}

export function imageToDisplay(point: Point, placement: ImagePlacement): Point {
  return {
    x: placement.offsetX + point.x * placement.scale,
    y: placement.offsetY + point.y * placement.scale,
  };
}

export function displayToImage(
  point: Point,
  placement: ImagePlacement,
  imageSize: ImageSize
): Point {
  const x = (point.x - placement.offsetX) / placement.scale;
  const y = (point.y - placement.offsetY) / placement.scale;

  return {
    x: Math.max(0, Math.min(imageSize.width, x)),
    y: Math.max(0, Math.min(imageSize.height, y)),
  };
}

export function createDefaultManualMeasurePoints(
  imageSize: ImageSize
): ManualMeasurePoints {
  const centerX = imageSize.width / 2;
  const centerY = imageSize.height / 2;
  const radius = Math.max(12, Math.min(imageSize.width, imageSize.height) * 0.12);

  return [
    { x: centerX, y: Math.max(0, centerY - radius) },
    { x: Math.min(imageSize.width, centerX + radius), y: centerY },
    { x: centerX, y: Math.min(imageSize.height, centerY + radius) },
    { x: Math.max(0, centerX - radius), y: centerY },
  ];
}

export function createDefaultManualGuideLines(imageSize: ImageSize): ManualGuideLines {
  const centerX = imageSize.width / 2;
  const centerY = imageSize.height / 2;
  const radius = Math.max(12, Math.min(imageSize.width, imageSize.height) * 0.12);

  return {
    leftX: Math.max(0, centerX - radius),
    rightX: Math.min(imageSize.width, centerX + radius),
    topY: Math.max(0, centerY - radius),
    bottomY: Math.min(imageSize.height, centerY + radius),
  };
}

export function guideLinesToPoints(guides: ManualGuideLines): ManualMeasurePoints {
  const centerX = (guides.leftX + guides.rightX) / 2;
  const centerY = (guides.topY + guides.bottomY) / 2;

  return [
    { x: centerX, y: guides.topY },
    { x: guides.rightX, y: centerY },
    { x: centerX, y: guides.bottomY },
    { x: guides.leftX, y: centerY },
  ];
}

export function parseForceKgf(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const match = String(value ?? '').match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveMicronsPerPixel({
  calibrationSettings,
  calibrations,
  machineState,
}: ResolveMicronsPerPixelArgs): number | null {
  return resolveManualCalibration({
    calibrationSettings,
    calibrations,
    machineState,
  })?.micronPerPixel ?? null;
}

export function resolveManualCalibration({
  calibrationSettings,
  calibrations,
  machineState,
}: ResolveMicronsPerPixelArgs): ManualCalibrationInfo | null {
  if (calibrationSettings?.pixelToMicron && calibrationSettings.pixelToMicron > 0) {
    return {
      micronPerPixel: calibrationSettings.pixelToMicron,
      calibrationName: calibrationSettings.objective,
      objective: calibrationSettings.objective,
    };
  }

  const candidates = calibrations
    .filter((item) => item.pixelLengthX > 0 || item.pixelLengthY > 0)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  const matching = candidates.find((item) => {
    if (!machineState) {
      return false;
    }

    return (
      item.zoomTime === machineState.objective &&
      parseForceKgf(item.force) === parseForceKgf(machineState.force) &&
      item.hardnessLevel === machineState.hardnessLevel
    );
  });

  const selected = matching ?? candidates[0];
  if (!selected) {
    return null;
  }

  const axes = [selected.pixelLengthX, selected.pixelLengthY].filter(
    (value) => Number.isFinite(value) && value > 0
  );

  if (axes.length === 0) {
    return null;
  }

  const micronPerPixel = axes.reduce((sum, value) => sum + value, 0) / axes.length;
  return {
    micronPerPixel,
    calibrationName: `${selected.zoomTime} ${selected.force} ${selected.hardnessLevel}`,
    objective: selected.zoomTime,
  };
}

export function calculateManualMeasurement(
  points: ManualMeasurePoints,
  micronsPerPixel: number,
  forceKgf: number
): ManualMeasurementValues | null {
  const d1Px = distancePx(points[1], points[3]);
  const d2Px = distancePx(points[0], points[2]);
  const values = calculateManualCalibratedValuesFromPixels(
    d1Px,
    d2Px,
    micronsPerPixel,
    forceKgf
  );
  if (!values || values.hv === null) {
    return null;
  }

  return {
    d1: values.d1Um,
    d2: values.d2Um,
    average: values.averageUm,
    hv: values.hv,
  };
}

export function calculateManualDiagonals(
  points: ManualMeasurePoints,
  unitPerPixel: number
): ManualDiagonalValues | null {
  const d1Px = distancePx(points[1], points[3]);
  const d2Px = distancePx(points[0], points[2]);
  return calculateManualDiagonalsFromPixels(d1Px, d2Px, unitPerPixel);
}

export function calculateManualDiagonalsFromPixels(
  d1Px: number,
  d2Px: number,
  unitPerPixel: number
): ManualDiagonalValues | null {
  if (unitPerPixel <= 0 || d1Px <= 0 || d2Px <= 0) {
    return null;
  }

  const d1 = d1Px * unitPerPixel;
  const d2 = d2Px * unitPerPixel;

  return {
    d1: round(d1, 4),
    d2: round(d2, 4),
    average: round((d1 + d2) / 2, 4),
  };
}

export function calculateManualCalibratedValuesFromPixels(
  d1Px: number,
  d2Px: number,
  micronPerPixel: number,
  forceKgf?: number | null
): ManualCalibratedValues | null {
  if (d1Px <= 0 || d2Px <= 0 || micronPerPixel <= 0) {
    return null;
  }

  const d1Um = d1Px * micronPerPixel;
  const d2Um = d2Px * micronPerPixel;
  const averageUm = (d1Um + d2Um) / 2;
  const averageMm = averageUm / 1000;
  const hv =
    forceKgf && forceKgf > 0 && averageMm > 0
      ? round(VICKERS_CONSTANT * forceKgf / (averageMm * averageMm), 2)
      : null;

  return {
    d1Px: round(d1Px, 2),
    d2Px: round(d2Px, 2),
    d1Um: round(d1Um, 3),
    d2Um: round(d2Um, 3),
    averageUm: round(averageUm, 3),
    averageMm: round(averageMm, 6),
    hv,
  };
}
