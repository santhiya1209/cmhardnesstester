import type { Calibration } from '@/types/calibration';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import type { MachineState } from '@/types/machine';
import type {
  ManualCalibrationInfo,
  ManualDiagonalValues,
  ManualGuideLines,
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

/**
 * Canonical corner→diagonal conversion shared by Manual and Auto Measure.
 *
 * Manual Measure's guide lines are always axis-aligned (two vertical, two
 * horizontal), so its diagonals reduce to the horizontal/vertical spans between
 * the lines: d1 = |rightX - leftX|, d2 = |bottomY - topY| (its perpendicular
 * component is always zero). Auto Measure MUST use the exact same definition by
 * projecting the detected corners onto those axis-aligned spans — otherwise the
 * full corner-to-corner Euclidean distance would add a perpendicular offset
 * that Manual never has, making the two modes disagree on any tilted indent
 * even when the endpoints sit on the same image pixels.
 */
export function cornersToDiagonalsPx(corners: {
  top: Point;
  right: Point;
  bottom: Point;
  left: Point;
}): { d1Px: number; d2Px: number } {
  return {
    d1Px: Math.abs(corners.right.x - corners.left.x),
    d2Px: Math.abs(corners.bottom.y - corners.top.y),
  };
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

/**
 * True when a calibration exists for the given objective AND force.
 *
 * Calibration is stored per (objective, force) in the legacy `calibrations`
 * table. The objective-only calibration-settings scale is force-blind, so an
 * uncalibrated force would otherwise resolve a different force's scale and
 * silently produce an HV. Auto Measure is gated on this check so an
 * uncalibrated force never starts a measurement.
 */
export function hasCalibrationForForce(
  calibrations: Calibration[],
  objective: string | null | undefined,
  force: string | number | null | undefined
): boolean {
  const targetObjective = normalizeObjectiveName(objective);
  const targetForce = parseForceKgf(force);
  if (!targetObjective || targetForce === null) {
    return false;
  }
  return calibrations.some(
    (item) =>
      normalizeObjectiveName(item.zoomTime) === targetObjective &&
      parseForceKgf(item.force) === targetForce &&
      (item.pixelLengthX > 0 || item.pixelLengthY > 0)
  );
}

/**
 * Selects the single legacy `calibrations` row that measurement uses for a
 * given objective: newest-first, but preferring the row saved for the active
 * force (and hardness level) when the machine state is known. Shared by
 * `resolveManualCalibration` (the measurement scale) and
 * `resolveActiveCalibration` (the status display) so the two can never pick a
 * different row and therefore never disagree.
 */
export function selectLegacyCalibrationRecord(
  calibrations: Calibration[],
  objective: string | null | undefined,
  machineState?: MachineState | null
): Calibration | null {
  const target = normalizeObjectiveName(objective);
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
  const wantForce = parseForceKgf(machineState?.force);
  const wantLevel = machineState?.hardnessLevel ?? null;
  return (
    (wantForce !== null
      ? legacyForObjective.find(
          (item) =>
            parseForceKgf(item.force) === wantForce &&
            (wantLevel === null || item.hardnessLevel === wantLevel)
        ) ?? legacyForObjective.find((item) => parseForceKgf(item.force) === wantForce)
      : undefined) ?? legacyForObjective[0] ?? null
  );
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
    const legacy = selectLegacyCalibrationRecord(calibrations, target, machineState);
    if (!legacy) {
      return null;
    }
    const realX = typeof legacy.realDistanceX === 'number' ? legacy.realDistanceX : 0;
    const realY = typeof legacy.realDistanceY === 'number' ? legacy.realDistanceY : 0;
    const pxX = legacy.pixelLengthX;
    const pxY = legacy.pixelLengthY;
    const computedX = pxX > 0 && realX > 0 ? realX / pxX : null;
    const computedY = pxY > 0 && realY > 0 ? realY / pxY : null;

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
      const axes = [pxX, pxY].filter((value) => Number.isFinite(value) && value > 0);
      if (axes.length === 0) {
        return null;
      }
      micronPerPixelX = pxX > 0 ? pxX : pxY;
      micronPerPixelY = pxY > 0 ? pxY : pxX;
      micronPerPixel = axes.reduce((sum, value) => sum + value, 0) / axes.length;
    }

    if (!Number.isFinite(micronPerPixel) || micronPerPixel <= 0) {
      return null;
    }

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

export type ActiveCalibrationResolution =
  | {
      status: 'calibrated';
      calibration: {
        calibrationId: string | null;
        objective: string;
        force: string | null;
        certifiedHardnessHv: number | null;
        calibrationName: string | null;
        calibratedAt: string | null;
        micronPerPixel: number;
      };
    }
  | { status: 'not-calibrated' };

/**
 * The active calibration for an objective, resolved through the SAME path
 * (`resolveManualCalibration` + `selectLegacyCalibrationRecord`) that Manual and
 * Auto Measure use to pick the micron scale. Certified hardness / force / date
 * are read from that same source row, so the status display can never disagree
 * with the calibration a measurement will actually apply. Certified hardness is
 * surfaced for display only — it defines the scale and is never substituted for
 * a measured result.
 */
export function resolveActiveCalibration({
  calibrations,
  calibrationSettings,
  calibrationSettingsList,
  machineState,
  objective,
}: {
  calibrations: Calibration[];
  calibrationSettings?: CalibrationSettings | null;
  calibrationSettingsList?: CalibrationSettings[];
  machineState?: MachineState | null;
  objective: string | null;
}): ActiveCalibrationResolution {
  const target = normalizeObjectiveName(objective);
  if (!isValidObjectiveName(target)) {
    return { status: 'not-calibrated' };
  }

  // Same inputs and precedence the measurement pipeline uses: objective-based
  // calibration-settings win over the legacy per-force `calibrations` table.
  const info = resolveManualCalibration({
    calibrationSettings: calibrationSettings ?? null,
    calibrationSettingsList,
    calibrations,
    machineState,
    targetObjective: target,
  });
  if (!info || !(info.micronPerPixel > 0)) {
    return { status: 'not-calibrated' };
  }

  const settingsList =
    calibrationSettingsList ?? (calibrationSettings ? [calibrationSettings] : []);
  const settingsMatch = findCalibrationForObjective(settingsList, target);
  // Certified hardness / force / date live only on the legacy `calibrations`
  // row; calibration-settings carry no certified value.
  const record = selectLegacyCalibrationRecord(calibrations, target, machineState);
  return {
    status: 'calibrated',
    calibration: {
      calibrationId: settingsMatch?.id ?? record?.id ?? null,
      objective: info.objective ?? target,
      force: record?.force ?? (machineState?.force != null ? String(machineState.force) : null),
      certifiedHardnessHv:
        record && typeof record.hardness === 'number' && Number.isFinite(record.hardness)
          ? record.hardness
          : null,
      calibrationName: info.calibrationName,
      calibratedAt: record?.createdAt ?? settingsMatch?.calibrationDate ?? null,
      micronPerPixel: info.micronPerPixel,
    },
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
  const xUmPerPixel = legacyCalibration?.micronPerPixelX ?? umPerPixel;
  const yUmPerPixel = legacyCalibration?.micronPerPixelY ?? umPerPixel;

  if (umPerPixel <= 0 || xUmPerPixel <= 0 || yUmPerPixel <= 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[calibration-apply-skipped] reason=no-matching-calibration objective=${normalizedObjective}`
    );
    return {
      ok: false,
      reason: `Calibration not found for ${normalizedObjective}. Please calibrate this objective before measurement.`,
      normalizedObjective,
    };
  }

  const calibrationSource = calibration ? 'calibration-settings' : 'legacy-calibration';
  // eslint-disable-next-line no-console
  console.log(
    `[calibration-apply] objective=${normalizedObjective} umPerPixel=${umPerPixel} source=${calibrationSource}`
  );

  const d1Um = d1Px * xUmPerPixel;
  const d2Um = d2Px * yUmPerPixel;
  const d1Mm = d1Um / 1000;
  const d2Mm = d2Um / 1000;
  const avgDUm = (d1Um + d2Um) / 2;
  const avgDMm = avgDUm / 1000;

  if (avgDMm <= 0) {
    return { ok: false, reason: 'Average diagonal is zero.', normalizedObjective };
  }

  const hasForce = typeof forceKgf === 'number' && Number.isFinite(forceKgf) && forceKgf > 0;
  const hv = hasForce ? VICKERS_CONSTANT * (forceKgf as number) / (avgDMm * avgDMm) : null;
  const effectiveForceKgf = hasForce ? (forceKgf as number) : null;
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
