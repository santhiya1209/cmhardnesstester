import type { Calibration } from '@/types/calibration';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import type { MachineState } from '@/types/machine';
import type {
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
  if (calibrationSettings?.pixelToMicron && calibrationSettings.pixelToMicron > 0) {
    return calibrationSettings.pixelToMicron;
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
      item.force === String(machineState.force) &&
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

  return axes.reduce((sum, value) => sum + value, 0) / axes.length;
}

export function calculateManualMeasurement(
  points: ManualMeasurePoints,
  micronsPerPixel: number,
  forceKgf: number
): ManualMeasurementValues | null {
  if (micronsPerPixel <= 0 || forceKgf <= 0) {
    return null;
  }

  const d1 = distancePx(points[0], points[2]) * micronsPerPixel;
  const d2 = distancePx(points[1], points[3]) * micronsPerPixel;
  const average = (d1 + d2) / 2;
  const averageMm = average / 1000;

  if (averageMm <= 0) {
    return null;
  }

  return {
    d1: round(d1, 4),
    d2: round(d2, 4),
    average: round(average, 4),
    hv: round(VICKERS_CONSTANT * forceKgf / (averageMm * averageMm), 2),
  };
}
