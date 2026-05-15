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
  /**
   * When provided, resolution prefers a calibration record whose objective
   * matches this value. If no exact match exists, returns null instead of
   * silently falling back to a different objective's calibration.
   */
  targetObjective?: string | null;
  calibrationSettingsList?: CalibrationSettings[];
};

export const VALID_OBJECTIVE_NAMES = ['2.5X', '5X', '10X', '20X', '40X', '50X'] as const;
export const INVALID_OBJECTIVE_MESSAGE =
  'Invalid objective selected. Please select 2.5X, 5X, 10X, 20X, 40X, or 50X.';

export type ValidObjectiveName = (typeof VALID_OBJECTIVE_NAMES)[number];

export type VickersFromPixelsValue = {
  objective: string;
  normalizedObjective: ValidObjectiveName;
  d1Px: number;
  d2Px: number;
  d1Um: number;
  d2Um: number;
  d1Mm: number;
  d2Mm: number;
  avgDUm: number;
  avgDMm: number;
  // forceKgf and hv become null when force is missing. D1µm/D2µm/Davg are
  // still produced from calibration alone — the table now shows the µm
  // diagonals and a blank HV instead of refusing to create a row at all.
  forceKgf: number | null;
  hv: number | null;
  calibrationId: string;
  calibrationName: string | null;
  umPerPixel: number;
  pixelPerMm: number;
};

export type VickersFromPixelsResult =
  | { ok: true; value: VickersFromPixelsValue }
  | { ok: false; reason: string; normalizedObjective?: string };

type CalculateVickersFromPixelsArgs = ResolveMicronsPerPixelArgs & {
  d1Px: number;
  d2Px: number;
  forceKgf: number | null | undefined;
  objective: string | null | undefined;
};

export function normalizeObjectiveName(objective: string | null | undefined): string {
  const compact = String(objective ?? '')
    .trim()
    .toUpperCase()
    .replace(/^OBJECTIVE\s*/, '')
    .replace(/\s+/g, '');
  const match = compact.match(/^(2\.5|5|10|20|40|50)X$/);
  return match ? `${match[1]}X` : compact;
}

export function isValidObjectiveName(objective: string | null | undefined): objective is ValidObjectiveName {
  return VALID_OBJECTIVE_NAMES.includes(normalizeObjectiveName(objective) as ValidObjectiveName);
}

export function readUmPerPixel(calibration: CalibrationSettings | null | undefined): number {
  if (!calibration) return 0;
  const value = calibration.umPerPixel ?? calibration.pixelToMicron;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function pixelsToMicrons(
  pixelDistance: number,
  micronsPerPixel: number | null | undefined
): number | null {
  if (
    !Number.isFinite(pixelDistance) ||
    pixelDistance < 0 ||
    typeof micronsPerPixel !== 'number' ||
    !Number.isFinite(micronsPerPixel) ||
    micronsPerPixel <= 0
  ) {
    return null;
  }
  return pixelDistance * micronsPerPixel;
}

export function formatMicronDisplay(value: number): string {
  return `${value.toFixed(2)}um`;
}

export function findCalibrationForObjective(
  list: CalibrationSettings[],
  objective: string | null | undefined
): CalibrationSettings | null {
  const target = normalizeObjectiveName(objective);
  if (!isValidObjectiveName(target)) {
    return null;
  }
  const matches = list.filter(
    (item) =>
      (normalizeObjectiveName(item.normalizedObjective) === target ||
        normalizeObjectiveName(item.objective) === target) &&
      readUmPerPixel(item) > 0
  );
  if (matches.length === 0) {
    return null;
  }
  return [...matches].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  )[0];
}

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

// Vickers indent pixel size scales linearly with magnification. Default the
// initial manual cross to roughly the size of an indent at the active
// objective — at 40X the legacy 12% radius lands near the indent edges; at
// 10X that's ~4× too big and the user sees a cross floating far from the
// actual diamond. Anything outside the known list keeps the legacy 12%.
function radiusFractionForObjective(objective: string | null | undefined): number {
  const key = String(objective ?? '').trim().toUpperCase();
  if (key === '10X') return 0.04;
  if (key === '20X') return 0.08;
  return 0.12;
}

export function createDefaultManualGuideLines(
  imageSize: ImageSize,
  objective?: string | null
): ManualGuideLines {
  const centerX = imageSize.width / 2;
  const centerY = imageSize.height / 2;
  const fraction = radiusFractionForObjective(objective);
  const radius = Math.max(12, Math.min(imageSize.width, imageSize.height) * fraction);

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

// Industrial qualification: HV must lie within the workpiece's configured
// [targetMinHv, targetMaxHv]. Returns null when no target range is set so
// the table renderer can leave the cell blank rather than reporting NO for
// unconfigured tests. Inclusive comparison matches typical material specs.
export function computeQualified(
  hv: number | null | undefined,
  targetMinHv: number | null | undefined,
  targetMaxHv: number | null | undefined
): 'YES' | 'NO' | null {
  if (typeof hv !== 'number' || !Number.isFinite(hv)) return null;
  const minSet = typeof targetMinHv === 'number' && Number.isFinite(targetMinHv) && targetMinHv > 0;
  const maxSet = typeof targetMaxHv === 'number' && Number.isFinite(targetMaxHv) && targetMaxHv > 0;
  if (!minSet && !maxSet) return null;
  const min = minSet ? (targetMinHv as number) : -Infinity;
  const max = maxSet ? (targetMaxHv as number) : Infinity;
  return hv >= min && hv <= max ? 'YES' : 'NO';
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
  targetObjective,
  calibrationSettingsList,
}: ResolveMicronsPerPixelArgs): ManualCalibrationInfo | null {
  // Per-objective lookup takes priority. If a target objective is provided we
  // MUST match it exactly — never silently fall back to another objective's
  // calibration value.
  const target = normalizeObjectiveName(targetObjective);
  if (target) {
    const list = calibrationSettingsList ?? (calibrationSettings ? [calibrationSettings] : []);
    const match = findCalibrationForObjective(list, target);
    if (match) {
      const micronPerPixel = readUmPerPixel(match);
      return {
        micronPerPixel,
        calibrationName: match.objective,
        objective: match.normalizedObjective ?? normalizeObjectiveName(match.objective),
      };
    }
    // No matching per-objective calibration. Try legacy `calibrations` list
    // filtered to the same objective only — never cross objectives.
    const legacyForObjective = calibrations
      .filter(
        (item) =>
          normalizeObjectiveName(item.zoomTime) === target &&
          (item.pixelLengthX > 0 ||
            item.pixelLengthY > 0 ||
            (typeof item.realDistanceX === 'number' && item.realDistanceX > 0) ||
            (typeof item.realDistanceY === 'number' && item.realDistanceY > 0))
      )
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    const legacy = legacyForObjective[0];
    if (!legacy) {
      return null;
    }
    // Calibration coefficient: when the user filled BOTH the measured pixel
    // span AND the real-world distance, compute µm/pixel = realDistance /
    // pixelLength per axis. Otherwise fall back to the legacy interpretation
    // where pixelLengthX/Y is itself the µm/pixel coefficient — keeps any
    // pre-existing rows working without forcing the user to re-enter them.
    const realX = typeof legacy.realDistanceX === 'number' ? legacy.realDistanceX : 0;
    const realY = typeof legacy.realDistanceY === 'number' ? legacy.realDistanceY : 0;
    const pxX = legacy.pixelLengthX;
    const pxY = legacy.pixelLengthY;
    const computedX = pxX > 0 && realX > 0 ? realX / pxX : null;
    const computedY = pxY > 0 && realY > 0 ? realY / pxY : null;

    // eslint-disable-next-line no-console
    console.log(
      `[calibration-compute] objective=${target} pixelX=${pxX} realX=${realX} umPerPixelX=${computedX ?? 'n/a'}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[calibration-compute] objective=${target} pixelY=${pxY} realY=${realY} umPerPixelY=${computedY ?? 'n/a'}`
    );

    let micronPerPixel = 0;
    let micronPerPixelX: number | undefined;
    let micronPerPixelY: number | undefined;
    if (computedX !== null && computedY !== null) {
      micronPerPixelX = computedX;
      micronPerPixelY = computedY;
      micronPerPixel = (computedX + computedY) / 2;
    } else if (computedX !== null) {
      micronPerPixelX = computedX;
      micronPerPixelY = computedX;
      micronPerPixel = computedX;
    } else if (computedY !== null) {
      micronPerPixelX = computedY;
      micronPerPixelY = computedY;
      micronPerPixel = computedY;
    } else {
      // Legacy fallback for calibrations saved BEFORE the knownReferenceUm
      // flow existed (no realDistance). Treat pxX/pxY as µm/pixel directly so
      // pre-existing rows / per-objective lookups don't break. New saves go
      // through the realDistance branch above and are unaffected.
      const axes = [pxX, pxY].filter((value) => Number.isFinite(value) && value > 0);
      if (axes.length === 0) {
        return null;
      }
      micronPerPixelX = pxX > 0 ? pxX : pxY;
      micronPerPixelY = pxY > 0 ? pxY : pxX;
      micronPerPixel = axes.reduce((sum, value) => sum + value, 0) / axes.length;
      // eslint-disable-next-line no-console
      console.warn(
        `[calibration-legacy-fallback] objective=${target} pxX=${pxX} pxY=${pxY} — no knownReferenceUm; treating pixelLength as µm/pixel for back-compat`
      );
    }

    if (!Number.isFinite(micronPerPixel) || micronPerPixel <= 0) {
      return null;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[measurement-scale] objective=${target} xUmPerPixel=${micronPerPixelX ?? 'n/a'} yUmPerPixel=${micronPerPixelY ?? 'n/a'} avg=${micronPerPixel}`
    );

    return {
      micronPerPixel,
      micronPerPixelX,
      micronPerPixelY,
      calibrationName: `${legacy.zoomTime} ${legacy.force} ${legacy.hardnessLevel}`,
      objective: legacy.zoomTime,
    };
  }

  if (calibrationSettings && readUmPerPixel(calibrationSettings) > 0) {
    const micronPerPixel = readUmPerPixel(calibrationSettings);
    return {
      micronPerPixel,
      calibrationName: calibrationSettings.objective,
      objective: calibrationSettings.normalizedObjective ?? normalizeObjectiveName(calibrationSettings.objective),
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
      normalizeObjectiveName(item.zoomTime) === normalizeObjectiveName(machineState.objective) &&
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

export function calculateVickersFromPixels({
  calibrationSettings,
  calibrationSettingsList,
  calibrations,
  d1Px,
  d2Px,
  forceKgf,
  machineState,
  objective,
}: CalculateVickersFromPixelsArgs): VickersFromPixelsResult {
  const normalizedObjective = normalizeObjectiveName(objective);

  if (!normalizedObjective) {
    return { ok: false, reason: 'Calibration required to calculate µm and HV' };
  }

  if (!isValidObjectiveName(normalizedObjective)) {
    return { ok: false, reason: INVALID_OBJECTIVE_MESSAGE, normalizedObjective };
  }

  if (!Number.isFinite(d1Px) || !Number.isFinite(d2Px) || d1Px <= 0 || d2Px <= 0) {
    return { ok: false, reason: 'D1/D2 pixel values are invalid.', normalizedObjective };
  }

  // Calibration is required to convert pixels → microns. Resolve it BEFORE
  // checking force, because force only affects HV — D1µm/D2µm/Davg can be
  // produced without it. Refusing the whole row when force is missing is
  // what was leaving the measurement table blank.
  const calibration = findCalibrationForObjective(
    calibrationSettingsList ?? (calibrationSettings ? [calibrationSettings] : []),
    normalizedObjective
  );
  const legacyCalibration = calibration
    ? null
    : resolveManualCalibration({
        calibrationSettings,
        calibrationSettingsList,
        calibrations,
        machineState,
        targetObjective: normalizedObjective,
      });
  const umPerPixel = calibration ? readUmPerPixel(calibration) : legacyCalibration?.micronPerPixel ?? 0;
  // Per-axis coefficients per spec: prefer the legacy Calibration record's
  // separate xUmPerPixel / yUmPerPixel (knownReferenceUm / pixelLengthX|Y).
  // calibration_settings only carries a single value, so X==Y in that case.
  const xUmPerPixel = legacyCalibration?.micronPerPixelX ?? umPerPixel;
  const yUmPerPixel = legacyCalibration?.micronPerPixelY ?? umPerPixel;

  if (umPerPixel <= 0 || xUmPerPixel <= 0 || yUmPerPixel <= 0) {
    return {
      ok: false,
      reason: `Calibration not found for ${normalizedObjective}. Please calibrate this objective before measurement.`,
      normalizedObjective,
    };
  }

  const d1Um = d1Px * xUmPerPixel;
  const d2Um = d2Px * yUmPerPixel;
  const d1Mm = d1Um / 1000;
  const d2Mm = d2Um / 1000;
  const avgDUm = (d1Um + d2Um) / 2;
  const avgDMm = avgDUm / 1000;

  if (avgDMm <= 0) {
    return { ok: false, reason: 'Average diagonal is zero.', normalizedObjective };
  }

  // HV needs force. Without force we still emit D1µm/D2µm/Davg so the table
  // is populated; HV column displays "-" via formatHardness(null).
  const hasForce = typeof forceKgf === 'number' && Number.isFinite(forceKgf) && forceKgf > 0;
  const hv = hasForce ? VICKERS_CONSTANT * (forceKgf as number) / (avgDMm * avgDMm) : null;
  const effectiveForceKgf = hasForce ? (forceKgf as number) : null;
  if (!hasForce) {
    // eslint-disable-next-line no-console
    console.warn(
      `[measurement-hv-skipped] reason=force-missing objective=${normalizedObjective} d1Um=${d1Um} d2Um=${d2Um} davgUm=${avgDUm} — row will save with hv=null`
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[calibration] objective=${normalizedObjective} umPerPixel=${umPerPixel}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[measurement-scale] objective=${normalizedObjective} xUmPerPixel=${xUmPerPixel} yUmPerPixel=${yUmPerPixel}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[measurement-convert]\nd1Px=${d1Px}\nd2Px=${d2Px}\nxUmPerPixel=${xUmPerPixel}\nyUmPerPixel=${yUmPerPixel}\nd1Um=${d1Um}\nd2Um=${d2Um}\ndavgUm=${avgDUm}\nhv=${hv ?? 'n/a'}`
  );
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] D1_px=${d1Px} D2_px=${d2Px}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] D1_um=${d1Um} D2_um=${d2Um}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] D1_mm=${d1Mm} D2_mm=${d2Mm}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] averageDiagonal_mm=${avgDMm}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] force_kgf=${effectiveForceKgf ?? 'missing'}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] HV=${hv ?? 'n/a (force missing)'}`);
  // eslint-disable-next-line no-console
  console.log(
    `[measurement-hv] objective=${normalizedObjective} force=${effectiveForceKgf ?? 'missing'} davgUm=${avgDUm} hv=${hv ?? 'n/a'}`
  );
  const calibrationId = calibration?.id ?? '';

  return {
    ok: true,
    value: {
      objective: normalizedObjective,
      normalizedObjective,
      d1Px: round(d1Px, 2),
      d2Px: round(d2Px, 2),
      d1Um: round(d1Um, 3),
      d2Um: round(d2Um, 3),
      d1Mm: round(d1Mm, 6),
      d2Mm: round(d2Mm, 6),
      avgDUm: round(avgDUm, 3),
      avgDMm: round(avgDMm, 6),
      forceKgf: effectiveForceKgf,
      hv: hv === null ? null : round(hv, 2),
      calibrationId,
      calibrationName: calibration?.objective ?? legacyCalibration?.calibrationName ?? normalizedObjective,
      umPerPixel,
      pixelPerMm: round(1000 / umPerPixel, 6),
    },
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

  // eslint-disable-next-line no-console
  console.log(`[hv-calc] D1_px=${d1Px} D2_px=${d2Px}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] D1_um=${d1Um} D2_um=${d2Um}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] D1_mm=${d1Um / 1000} D2_mm=${d2Um / 1000}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] averageDiagonal_mm=${averageMm}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] force_kgf=${forceKgf ?? 0}`);
  // eslint-disable-next-line no-console
  console.log(`[hv-calc] HV=${hv}`);

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
