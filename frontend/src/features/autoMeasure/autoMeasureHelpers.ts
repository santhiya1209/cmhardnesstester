import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import {
  normalizeAutoMeasureSettings,
  OBJECTIVE_FOR_MEASURE_OPTIONS,
  type AutoMeasureSettingsPayload,
  type ObjectiveForMeasure,
} from '@/types/autoMeasureSettings';
import type {
  AutoMeasureCorners,
  AutoMeasureGraphics,
  VickersAutoMeasureResult,
  VickersAutoMeasureSuccess,
} from '@/types/autoMeasure';
import type { MachineState } from '@/types/machine';

const POINT_TOL_PX = 0.5;
function pointAlmostEqual(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < POINT_TOL_PX && Math.abs(a.y - b.y) < POINT_TOL_PX;
}
export function graphicsAlmostEqual(a: AutoMeasureGraphics, b: AutoMeasureGraphics): boolean {
  if (
    !pointAlmostEqual(a.corners.top, b.corners.top) ||
    !pointAlmostEqual(a.corners.right, b.corners.right) ||
    !pointAlmostEqual(a.corners.bottom, b.corners.bottom) ||
    !pointAlmostEqual(a.corners.left, b.corners.left)
  ) {
    return false;
  }
  if (a.lines.length !== b.lines.length) return false;
  for (let i = 0; i < a.lines.length; i += 1) {
    if (
      !pointAlmostEqual(a.lines[i].p1, b.lines[i].p1) ||
      !pointAlmostEqual(a.lines[i].p2, b.lines[i].p2)
    ) {
      return false;
    }
  }
  return true;
}

export function autoMeasureSettingsEqual(
  a: AutoMeasureSettingsPayload,
  b: AutoMeasureSettingsPayload
): boolean {
  return JSON.stringify(normalizeAutoMeasureSettings(a)) === JSON.stringify(normalizeAutoMeasureSettings(b));
}

export type AutoMeasureDetectionSnapshot = {
  settings: AutoMeasureSettingsPayload;
  result: VickersAutoMeasureSuccess;
  graphics: AutoMeasureGraphics;
  method: AutoMeasureDetectionMethod;
  validationReason: string;
  objectiveForCalibration: string;
  machineStateForAuto: MachineState | null;
  forceKgf: number | null;
};

export type AutoMeasureDetectionMethod = 'refined' | 'rough';

export type CommittedAutoMeasureFingerprint = {
  objective: string;
  frameId: number | null;
  centerX: number;
  centerY: number;
  d1Px: number;
  d2Px: number;
  hv: number | null;
  d1Um: number | null;
  d2Um: number | null;
  avgDUm: number | null;
  avgDMm: number | null;
  rowId: string | null;
  fingerprintKey: string;
  corners: AutoMeasureGraphics['corners'];
  graphics: AutoMeasureGraphics;
};

export type AutoMeasureCallSource = 'auto-click' | 'settings-preview' | 'settings-save' | 'after-impress';

export type CapturedAutoMeasureFrame = Extract<
  ReturnType<CameraWindowHandle['captureDisplayedFrame']>,
  { ok: true }
>;

export type RunAutoMeasure = (
  settingsInput: AutoMeasureSettingsPayload,
  preview?: boolean,
  source?: AutoMeasureCallSource
) => Promise<boolean>;

export type CommitAutoMeasureSource = 'auto-click' | 'settings-save' | 'after-impress';

export function logUnexpectedAutoMeasureCall(source: string) {
  if (
    source === 'auto-click' ||
    source === 'settings-preview' ||
    source === 'settings-save' ||
    source === 'after-impress'
  ) {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[auto-measure-unexpected-call] source=${source} stack=${new Error().stack ?? 'unavailable'}`
  );
}

export const AUTO_MEASURE_CENTER_TOLERANCE_PX = 3;
export const AUTO_MEASURE_DIAGONAL_TOLERANCE_PX = 3;
export const AUTO_MEASURE_CORNER_TOLERANCE_PX = 4;
export const AUTO_MEASURE_HARDNESS_TOLERANCE_HV = 10;
const AUTO_MEASURE_STABLE_PIXEL_DIGITS = 2;
const AUTO_MEASURE_CORNER_KEYS = ['top', 'right', 'bottom', 'left'] as const;

export function normalizeAutoMeasureFingerprintObjective(objective: string | null | undefined): string {
  return (objective ?? 'unknown').trim().toUpperCase() || 'UNKNOWN';
}

export function buildAutoMeasureFingerprintKey({
  objective,
  centerX,
  centerY,
  d1Px,
  d2Px,
}: {
  objective: string;
  centerX: number;
  centerY: number;
  d1Px: number;
  d2Px: number;
}): string {
  return [
    objective,
    Math.round(centerX),
    Math.round(centerY),
    Math.round(d1Px),
    Math.round(d2Px),
  ].join('|');
}

export function roundAutoMeasurePixel(value: number): number {
  return Number(value.toFixed(AUTO_MEASURE_STABLE_PIXEL_DIGITS));
}

export function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getAutoMeasureMaxCornerDelta(
  a: AutoMeasureGraphics['corners'],
  b: AutoMeasureGraphics['corners']
): number {
  return AUTO_MEASURE_CORNER_KEYS.reduce((maxDelta, key) => {
    const dx = a[key].x - b[key].x;
    const dy = a[key].y - b[key].y;
    return Math.max(maxDelta, Math.hypot(dx, dy));
  }, 0);
}

export function cloneAutoMeasureGraphics(graphics: AutoMeasureGraphics): AutoMeasureGraphics {
  return {
    ...graphics,
    corners: {
      top: { ...graphics.corners.top },
      right: { ...graphics.corners.right },
      bottom: { ...graphics.corners.bottom },
      left: { ...graphics.corners.left },
    },
    lines: graphics.lines.map((line) => ({
      p1: { ...line.p1 },
      p2: { ...line.p2 },
    })),
  };
}

export function upsertCommittedAutoMeasureFingerprint(
  entries: CommittedAutoMeasureFingerprint[],
  entry: CommittedAutoMeasureFingerprint
): CommittedAutoMeasureFingerprint[] {
  const existingIndex = entries.findIndex(
    (candidate) => candidate.rowId !== null && candidate.rowId === entry.rowId
  );
  if (existingIndex === -1) {
    return [...entries, entry];
  }
  const next = [...entries];
  next[existingIndex] = entry;
  return next;
}

// Per-objective Auto Measure defaults. The user's machine-tuned values.
// These override whatever is currently in the Auto Measure Settings UI
// when a detection runs, and reset the UI when the objective changes.
const AUTO_MEASURE_OBJECTIVE_DEFAULTS: Record<string, { smoothing: number; threshold: number }> = {
  '10X': { smoothing: 4, threshold: 44 },
  '40X': { smoothing: 6, threshold: 91 },
};

export function autoMeasureDefaultsForObjective(
  objective: string | null | undefined
): { smoothing: number; threshold: number } | null {
  const key = String(objective ?? '').trim().toUpperCase();
  return AUTO_MEASURE_OBJECTIVE_DEFAULTS[key] ?? null;
}

export function objectiveForMeasureFromObjective(
  objective: string | null | undefined
): ObjectiveForMeasure | null {
  const key = String(objective ?? '').trim().toUpperCase();
  return (OBJECTIVE_FOR_MEASURE_OPTIONS as readonly string[]).includes(key)
    ? (key as ObjectiveForMeasure)
    : null;
}

export function applyAutoMeasureObjectiveProfile(
  settings: AutoMeasureSettingsPayload,
  objective: string | null | undefined
): AutoMeasureSettingsPayload {
  const objectiveForMeasure = objectiveForMeasureFromObjective(objective);
  const defaults = autoMeasureDefaultsForObjective(objectiveForMeasure);
  if (!objectiveForMeasure || !defaults) {
    return normalizeAutoMeasureSettings(settings);
  }
  return normalizeAutoMeasureSettings({
    ...settings,
    objectiveForMeasure,
    smoothing: defaults.smoothing,
    threshold: defaults.threshold,
    manualThreshold: defaults.threshold,
  });
}

export function formatAutoMeasureCorners(corners: AutoMeasureCorners | null | undefined): string {
  if (!corners) return '<null>';
  const point = (p: { x: number; y: number }) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`;
  return `<L${point(corners.left)} R${point(corners.right)} T${point(corners.top)} B${point(corners.bottom)}>`;
}

type AutoMeasureLogContext = {
  objective: string | null | undefined;
  smoothing: number;
  threshold: number;
  method?: AutoMeasureDetectionMethod;
  d1Px?: number | null;
  d2Px?: number | null;
  center?: { x: number; y: number } | null;
  reason?: string;
  extra?: string;
};

type AutoMeasureGeometryValidation = {
  ok: boolean;
  reason: string;
  d1Px: number;
  d2Px: number;
  ratio: number;
  center: { x: number; y: number };
};

type ResolvedAutoMeasureDetection =
  | {
      ok: true;
      result: VickersAutoMeasureSuccess;
      method: AutoMeasureDetectionMethod;
      reason: string;
      validation: AutoMeasureGeometryValidation;
      fallbackUsed: boolean;
    }
  | {
      ok: false;
      reason: string;
      method: AutoMeasureDetectionMethod;
      validation?: AutoMeasureGeometryValidation;
    };

const MIN_AUTO_MEASURE_DIAGONAL_PX = 6;
const MAX_AUTO_MEASURE_DIAGONAL_RATIO = 4;

export function formatAutoMeasureNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : 'n/a';
}

export function cloneCapturedFrame(frame: CapturedAutoMeasureFrame): CapturedAutoMeasureFrame {
  return {
    ...frame,
    buffer: frame.buffer.slice(0),
  };
}

function finitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function logAutoMeasurePhase(_phase: string, _context: AutoMeasureLogContext): void {
  // no-op (logging stripped)
}

export function hasValidAutoMeasureCorners(result: VickersAutoMeasureSuccess): boolean {
  return (
    finitePoint(result.corners.top) &&
    finitePoint(result.corners.right) &&
    finitePoint(result.corners.bottom) &&
    finitePoint(result.corners.left)
  );
}

function readAutoMeasurePoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as { x?: unknown; y?: unknown };
  const x = Number(point.x);
  const y = Number(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function readAutoMeasureCorners(value: unknown): AutoMeasureCorners | null {
  if (!value || typeof value !== 'object') return null;
  const corners = value as Record<keyof AutoMeasureCorners, unknown>;
  const top = readAutoMeasurePoint(corners.top);
  const right = readAutoMeasurePoint(corners.right);
  const bottom = readAutoMeasurePoint(corners.bottom);
  const left = readAutoMeasurePoint(corners.left);
  return top && right && bottom && left ? { top, right, bottom, left } : null;
}

function orderRoughDiamondPoints(points: { x: number; y: number }[]): AutoMeasureCorners | null {
  if (points.length !== 4 || points.some((point) => !finitePoint(point))) return null;
  const indexed = points.map((point, index) => ({ point, index }));
  const top = [...indexed].sort((a, b) => a.point.y - b.point.y || a.point.x - b.point.x)[0];
  const bottom = [...indexed].sort((a, b) => b.point.y - a.point.y || b.point.x - a.point.x)[0];
  const left = [...indexed].sort((a, b) => a.point.x - b.point.x || a.point.y - b.point.y)[0];
  const right = [...indexed].sort((a, b) => b.point.x - a.point.x || b.point.y - a.point.y)[0];
  if (new Set([top.index, right.index, bottom.index, left.index]).size !== 4) return null;
  return {
    top: top.point,
    right: right.point,
    bottom: bottom.point,
    left: left.point,
  };
}

function roughCornersFromRotatedRect(rect: unknown): AutoMeasureCorners | null {
  if (!rect || typeof rect !== 'object') return null;
  const source = rect as { center?: unknown; width?: unknown; height?: unknown; angle?: unknown };
  const center = readAutoMeasurePoint(source.center);
  const width = Number(source.width);
  const height = Number(source.height);
  const angle = Number(source.angle);
  if (!center || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const theta = (Number.isFinite(angle) ? angle : 0) * Math.PI / 180;
  const ux = { x: Math.cos(theta) * width / 2, y: Math.sin(theta) * width / 2 };
  const uy = { x: -Math.sin(theta) * height / 2, y: Math.cos(theta) * height / 2 };
  return orderRoughDiamondPoints([
    { x: center.x - ux.x - uy.x, y: center.y - ux.y - uy.y },
    { x: center.x + ux.x - uy.x, y: center.y + ux.y - uy.y },
    { x: center.x + ux.x + uy.x, y: center.y + ux.y + uy.y },
    { x: center.x - ux.x + uy.x, y: center.y - ux.y + uy.y },
  ]);
}

function readRoughAutoMeasureCorners(debug: Record<string, unknown>): {
  corners: AutoMeasureCorners;
  reason: string;
} | null {
  for (const key of ['roughCorners', 'contourCorners', 'initialCorners']) {
    const corners = readAutoMeasureCorners(debug[key]);
    if (corners) return { corners, reason: `debug-${key}` };
  }
  const rectCorners = roughCornersFromRotatedRect(debug.minAreaRect);
  if (rectCorners) return { corners: rectCorners, reason: 'debug-minAreaRect' };
  const finalCorners = readAutoMeasureCorners(debug.finalCorners);
  return finalCorners ? { corners: finalCorners, reason: 'debug-finalCorners' } : null;
}

export function validateAutoMeasureGeometry(
  corners: AutoMeasureCorners,
  context: Omit<AutoMeasureLogContext, 'd1Px' | 'd2Px' | 'center' | 'reason'> & {
    reason?: string;
  }
): AutoMeasureGeometryValidation {
  const finite =
    finitePoint(corners.top) &&
    finitePoint(corners.right) &&
    finitePoint(corners.bottom) &&
    finitePoint(corners.left);
  const d1Px = finite
    ? Math.hypot(corners.right.x - corners.left.x, corners.right.y - corners.left.y)
    : Number.NaN;
  const d2Px = finite
    ? Math.hypot(corners.bottom.x - corners.top.x, corners.bottom.y - corners.top.y)
    : Number.NaN;
  const midD1 = finite
    ? { x: (corners.left.x + corners.right.x) / 2, y: (corners.left.y + corners.right.y) / 2 }
    : { x: Number.NaN, y: Number.NaN };
  const midD2 = finite
    ? { x: (corners.top.x + corners.bottom.x) / 2, y: (corners.top.y + corners.bottom.y) / 2 }
    : { x: Number.NaN, y: Number.NaN };
  const center = {
    x: (midD1.x + midD2.x) / 2,
    y: (midD1.y + midD2.y) / 2,
  };
  const ratio = d2Px > 0 ? d1Px / d2Px : Number.NaN;
  const distinctDistances = finite
    ? [
        Math.hypot(corners.top.x - corners.right.x, corners.top.y - corners.right.y),
        Math.hypot(corners.right.x - corners.bottom.x, corners.right.y - corners.bottom.y),
        Math.hypot(corners.bottom.x - corners.left.x, corners.bottom.y - corners.left.y),
        Math.hypot(corners.left.x - corners.top.x, corners.left.y - corners.top.y),
      ]
    : [Number.NaN];
  const midpointOffset = Math.hypot(midD1.x - midD2.x, midD1.y - midD2.y);
  const minDiagonal = Math.min(d1Px, d2Px);
  const diagonalOk =
    Number.isFinite(d1Px) &&
    Number.isFinite(d2Px) &&
    d1Px >= MIN_AUTO_MEASURE_DIAGONAL_PX &&
    d2Px >= MIN_AUTO_MEASURE_DIAGONAL_PX;
  const ratioOk =
    Number.isFinite(ratio) &&
    ratio >= 1 / MAX_AUTO_MEASURE_DIAGONAL_RATIO &&
    ratio <= MAX_AUTO_MEASURE_DIAGONAL_RATIO;
  const orderOk =
    finite &&
    corners.left.x < corners.right.x &&
    corners.top.y < corners.bottom.y;
  const distinctOk = distinctDistances.every((distance) => distance >= 2);
  const centerOk =
    Number.isFinite(midpointOffset) &&
    Number.isFinite(minDiagonal) &&
    midpointOffset <= Math.max(12, minDiagonal * 0.65);
  const reason = !finite
    ? 'non-finite-corners'
    : !diagonalOk
      ? 'diagonals-too-small'
      : !ratioOk
        ? 'diagonal-ratio-out-of-range'
        : !orderOk
          ? 'corner-order-invalid'
          : !distinctOk
            ? 'corner-points-not-distinct'
            : !centerOk
              ? 'diagonal-centers-too-far-apart'
              : context.reason ?? 'geometry-usable';
  const validation = {
    ok: finite && diagonalOk && ratioOk && orderOk && distinctOk && centerOk,
    reason,
    d1Px,
    d2Px,
    ratio,
    center,
  };
  logAutoMeasurePhase('auto-measure-diamond-validation', {
    ...context,
    d1Px,
    d2Px,
    center,
    reason,
  });
  return validation;
}

function buildRoughAutoMeasureResult(
  raw: VickersAutoMeasureResult,
  corners: AutoMeasureCorners,
  reason: string
): VickersAutoMeasureSuccess {
  const d1Pixels = Math.hypot(corners.right.x - corners.left.x, corners.right.y - corners.left.y);
  const d2Pixels = Math.hypot(corners.bottom.x - corners.top.x, corners.bottom.y - corners.top.y);
  const debug = raw.debug ?? {};
  const confidence = Number((debug as { confidence?: unknown }).confidence);
  return {
    ok: true,
    source: raw.source === 'uploaded-image' ? 'uploaded-image' : 'live-camera',
    corners,
    lines: [
      { p1: corners.top, p2: corners.right },
      { p1: corners.right, p2: corners.bottom },
      { p1: corners.bottom, p2: corners.left },
      { p1: corners.left, p2: corners.top },
    ],
    d1Pixels,
    d2Pixels,
    d1Mm: null,
    d2Mm: null,
    averageMm: null,
    confidence: Number.isFinite(confidence) && confidence > 0 ? confidence : 0,
    hv: null,
    debug: {
      ...debug,
      frontendFallback: 'rough',
      frontendFallbackReason: reason,
    },
  };
}

export function resolveAutoMeasureDetection(
  raw: VickersAutoMeasureResult,
  context: Pick<AutoMeasureLogContext, 'objective' | 'smoothing' | 'threshold'>
): ResolvedAutoMeasureDetection {
  if (raw.ok) {
    const refinedResult = raw;
    const refinedCorners = refinedResult.corners;
    const validation = validateAutoMeasureGeometry(refinedCorners, {
      ...context,
      method: 'refined',
      reason: 'refined-corners',
    });
    logAutoMeasurePhase('auto-measure-refined-corners', {
      ...context,
      method: 'refined',
      d1Px: validation.d1Px,
      d2Px: validation.d2Px,
      center: validation.center,
      reason: validation.reason,
    });
    if (validation.ok) {
      const roughForLog = readRoughAutoMeasureCorners(raw.debug ?? {});
      if (roughForLog) {
        const roughValidation = validateAutoMeasureGeometry(roughForLog.corners, {
          ...context,
          method: 'rough',
          reason: roughForLog.reason,
        });
        logAutoMeasurePhase('auto-measure-rough-diamond', {
          ...context,
          method: 'rough',
          d1Px: roughValidation.d1Px,
          d2Px: roughValidation.d2Px,
          center: roughValidation.center,
          reason: roughValidation.reason,
          extra: `source=${roughForLog.reason} used=false`,
        });
      } else {
        logAutoMeasurePhase('auto-measure-rough-diamond', {
          ...context,
          method: 'rough',
          reason: 'rough-geometry-missing used=false',
        });
      }
      return {
        ok: true,
        result: refinedResult,
        method: 'refined',
        reason: validation.reason,
        validation,
        fallbackUsed: false,
      };
    }
  } else {
    logAutoMeasurePhase('auto-measure-refined-corners', {
      ...context,
      method: 'refined',
      reason: raw.reason,
    });
  }

  const debug = raw.debug ?? {};
  const rough = readRoughAutoMeasureCorners(debug);
  if (rough) {
    const validation = validateAutoMeasureGeometry(rough.corners, {
      ...context,
      method: 'rough',
      reason: rough.reason,
    });
    logAutoMeasurePhase('auto-measure-rough-diamond', {
      ...context,
      method: 'rough',
      d1Px: validation.d1Px,
      d2Px: validation.d2Px,
      center: validation.center,
      reason: validation.reason,
      extra: `source=${rough.reason}`,
    });
    if (validation.ok) {
      logAutoMeasurePhase('auto-measure-fallback-used', {
        ...context,
        method: 'rough',
        d1Px: validation.d1Px,
        d2Px: validation.d2Px,
        center: validation.center,
        reason: raw.ok ? 'refined-geometry-not-usable' : raw.reason,
        extra: `source=${rough.reason}`,
      });
      return {
        ok: true,
        result: buildRoughAutoMeasureResult(raw, rough.corners, rough.reason),
        method: 'rough',
        reason: rough.reason,
        validation,
        fallbackUsed: true,
      };
    }
  } else {
    logAutoMeasurePhase('auto-measure-rough-diamond', {
      ...context,
      method: 'rough',
      reason: 'rough-geometry-missing',
    });
  }

  const reason = raw.ok
    ? 'no usable diamond geometry'
    : raw.reason || 'no usable diamond geometry';
  return {
    ok: false,
    reason,
    method: raw.ok ? 'refined' : 'rough',
  };
}

export function graphicsFromAutoMeasureResult(
  result: VickersAutoMeasureSuccess,
  objective?: string | null
): AutoMeasureGraphics {
  // All objectives — 10X included — now use the four-guides layout that
  // 40X has always used. The native addon runs the same 4-edge side-fit +
  // intersection pipeline for every objective (`twoLineMode` is disabled),
  // and the frontend renders the same yellow edge/guide overlay.
  const norm = (objective ?? '').trim().toUpperCase();
  const lineLayout: 'four-guides' | 'two-diagonals' = 'four-guides';
  if (norm === '10X') {
  }
  const tagObjective = norm || null;
  if (result.lines.length === 4) {
    return { corners: result.corners, lines: result.lines, lineLayout, objective: tagObjective };
  }
  const { top, right, bottom, left } = result.corners;
  return {
    corners: result.corners,
    lines: [
      { p1: top, p2: right },
      { p1: right, p2: bottom },
      { p1: bottom, p2: left },
      { p1: left, p2: top },
    ],
    lineLayout,
    objective: tagObjective,
  };
}
