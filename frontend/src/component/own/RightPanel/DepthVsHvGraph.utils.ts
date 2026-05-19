import type { Measurement } from '@/types/measurement';

const UM_PER_MM = 1000;

type MeasurementGraphRow = Measurement & {
  depth?: unknown;
  distance?: unknown;
  distanceUm?: unknown;
  distanceMicrometer?: unknown;
  distanceMicrometers?: unknown;
  micrometer?: unknown;
  micrometerValue?: unknown;
  hardness?: unknown;
  hardnessValue?: unknown;
  davg?: unknown;
  davgUm?: unknown;
  measurementNumber?: unknown;
};

// Axis keys exposed in the UI. Keep these stable — they're persisted in
// localStorage and shown in the X/Y selects in the Depth Image tab.
export const X_AXIS_KEYS = [
  'depthUm',
  'depthMm',
  'd1Um',
  'd2Um',
  'davgUm',
  'measurementIndex',
  'hv',
] as const;
export const Y_AXIS_KEYS = ['hv', 'depthMm', 'depthUm', 'd1Um', 'd2Um', 'davgUm'] as const;
export type XAxisKey = (typeof X_AXIS_KEYS)[number];
export type YAxisKey = (typeof Y_AXIS_KEYS)[number];
export type AxisKey = XAxisKey | YAxisKey;

export const AXIS_LABEL: Record<AxisKey, string> = {
  depthMm: 'Depth (mm)',
  depthUm: 'Depth (µm)',
  d1Um: 'D1 (µm)',
  d2Um: 'D2 (µm)',
  davgUm: 'Davg (µm)',
  measurementIndex: 'Measurement #',
  hv: 'Hardness Value',
};

export type AxisGraphPoint = {
  id: string;
  sourceIndex: number;
  index: number;
  x: number;
  y: number;
};

export type DepthHvGraphPoint = {
  id: string;
  sourceIndex: number;
  index: number;
  distanceUm: number;
  hv: number;
};

export type Axis = {
  min: number;
  max: number;
  ticks: number[];
};

export type ChdIntersection = {
  depthMm: number;
  distanceUm: number;
  hv: number;
  segmentStart: DepthHvGraphPoint;
  segmentEnd: DepthHvGraphPoint;
};

export function formatDistance(value: number): string {
  return value >= 100 ? `${Math.round(value)} \u00B5m` : `${value.toFixed(1)} \u00B5m`;
}

export function formatHv(value: number): string {
  if (Number.isInteger(value)) return value >= 1000 ? value.toLocaleString('en-IN') : String(value);
  return value >= 1000 ? Math.round(value).toLocaleString('en-IN') : value.toFixed(2);
}

function readFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
      const match = value.match(/-?\d+(?:\.\d+)?/);
      if (match) {
        const parsedMatch = Number(match[0]);
        if (Number.isFinite(parsedMatch)) return parsedMatch;
      }
    }
  }
  return null;
}

function readDistanceUm(row: MeasurementGraphRow): number | null {
  const directUm = readFiniteNumber(row.distanceUm, row.distanceMicrometer, row.distanceMicrometers);
  if (directUm !== null) return directUm;

  const depthMm = readFiniteNumber(row.depthMm, row.depth, row.distance, row.micrometer, row.micrometerValue);
  return depthMm === null ? null : depthMm * UM_PER_MM;
}

function readDepthMm(row: MeasurementGraphRow): number | null {
  const direct = readFiniteNumber(
    row.depthMm,
    row.depth,
    row.distance,
    row.micrometer,
    row.micrometerValue,
    (row as { manualDepthMm?: unknown }).manualDepthMm,
    (row as { deviceDepthMm?: unknown }).deviceDepthMm
  );
  if (direct !== null) return direct;
  const um = readFiniteNumber(row.distanceUm, row.distanceMicrometer, row.distanceMicrometers);
  return um === null ? null : um / UM_PER_MM;
}

// Resolve a generic axis value from a row. Returns null when the row doesn't
// carry the requested field (or it isn't a positive finite number).
function readAxisValue(
  row: MeasurementGraphRow,
  key: AxisKey,
  sourceIndex: number
): number | null {
  switch (key) {
    case 'depthMm':
      return readDepthMm(row);
    case 'depthUm':
      return readDistanceUm(row);
    case 'd1Um':
      return readFiniteNumber(row.d1Um, row.unit === 'um' ? row.d1 : null);
    case 'd2Um':
      return readFiniteNumber(row.d2Um, row.unit === 'um' ? row.d2 : null);
    case 'davgUm':
      return readFiniteNumber(
        row.averageUm,
        row.davgUm,
        row.davg,
        row.unit === 'um' ? row.average : null
      );
    case 'measurementIndex':
      // 1-based row number (matches the table's # column).
      return sourceIndex + 1;
    case 'hv':
      return readFiniteNumber(row.hv, row.hardness, row.hardnessValue);
    default:
      return null;
  }
}

// Build generic {x, y} points for any X/Y axis pair. Skips rows where either
// axis can't be resolved. Sorted by x ascending (so the connecting line goes
// left→right) and re-indexed for tooltip / overlay use.
export function buildAxisGraphPoints(
  measurements: Measurement[],
  xKey: XAxisKey,
  yKey: YAxisKey
): AxisGraphPoint[] {
  // eslint-disable-next-line no-console
  console.log(`[depth-graph-source] count=${measurements.length} xKey=${xKey} yKey=${yKey}`);
  const points = measurements.flatMap((measurement, sourceIndex) => {
    const row = measurement as MeasurementGraphRow;
    const x = readAxisValue(row, xKey, sourceIndex);
    const y = readAxisValue(row, yKey, sourceIndex);
    // eslint-disable-next-line no-console
    console.log(
      `[depth-graph-row-map] rowId=${measurement.id} x=${x ?? 'null'} y=${y ?? 'null'}`
    );
    const xValid = x !== null && Number.isFinite(x);
    const yValid = y !== null && Number.isFinite(y);
    // X may legitimately be zero (depth=0 surface). Y must additionally be
    // positive for the HV axis to make physical sense; for non-HV Y values
    // (depth, diagonals) zero is also valid, so use the same finite check.
    if (!xValid || !yValid) {
      const reason = !xValid && !yValid ? 'x-invalid,y-invalid' : !xValid ? 'x-invalid' : 'y-invalid';
      // eslint-disable-next-line no-console
      console.log(`[depth-graph-invalid-row] rowId=${measurement.id} reason=${reason}`);
      return [];
    }
    return [
      {
        id: measurement.id,
        sourceIndex,
        index: 0,
        x: x as number,
        y: y as number,
      },
    ];
  });
  const sorted = points
    .sort((left, right) => left.x - right.x || left.sourceIndex - right.sourceIndex)
    .map((point, index) => ({ ...point, index: index + 1 }));
  // eslint-disable-next-line no-console
  console.log(`[depth-graph-points] count=${sorted.length}`);
  return sorted;
}

export function buildDepthHvGraphPoints(measurements: Measurement[]): DepthHvGraphPoint[] {
  // eslint-disable-next-line no-console
  console.log(`[depth-graph-source] count=${measurements.length}`);
  const points = measurements.flatMap((measurement, sourceIndex) => {
    const row = measurement as MeasurementGraphRow;
    const distanceUm = readDistanceUm(row);
    const hv = readFiniteNumber(row.hv, row.hardness, row.hardnessValue);
    // eslint-disable-next-line no-console
    console.log(
      `[depth-graph-row] id=${measurement.id} hv=${row.hv ?? 'null'} depthMm=${row.depthMm ?? 'null'} distanceUm=${distanceUm ?? 'null'} resolvedHv=${hv ?? 'null'}`
    );
    const hvValid = hv !== null && Number.isFinite(hv) && hv > 0;
    const depthValid = distanceUm !== null && Number.isFinite(distanceUm) && distanceUm >= 0;
    const usable = hvValid && depthValid;

    if (usable) {
      // eslint-disable-next-line no-console
      console.log(
        `[depth-graph-valid-row] id=${measurement.id} distanceUm=${distanceUm} hv=${hv}`
      );
      return [{ id: measurement.id, sourceIndex, index: 0, distanceUm: distanceUm as number, hv: hv as number }];
    }
    const reason = !hvValid && !depthValid
      ? 'hv-invalid,depth-invalid'
      : !hvValid
        ? 'hv-invalid'
        : 'depth-invalid';
    // eslint-disable-next-line no-console
    console.log(`[depth-graph-invalid-row] id=${measurement.id} reason=${reason}`);
    return [];
  });

  const sorted = points
    .sort((left, right) => left.distanceUm - right.distanceUm || left.sourceIndex - right.sourceIndex)
    .map((point, index) => ({ ...point, index: index + 1 }));
  // eslint-disable-next-line no-console
  console.log(`[depth-graph-points] count=${sorted.length}`);
  return sorted;
}

function niceNumber(value: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const niceFraction = round
    ? fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10
    : fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

export function buildAxis(values: number[], tickCount: number, includeZero: boolean): Axis {
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (includeZero && min >= 0) min = 0;
  if (min === max) {
    const padding = Math.max(Math.abs(max) * 0.08, 10);
    max += padding;
    if (!includeZero) min -= padding;
  }

  const step = niceNumber(Math.max((max - min) / tickCount, 1), true);
  const axisMin = includeZero && min >= 0 ? 0 : Math.floor(min / step) * step;
  const axisMax = Math.max(axisMin + step, Math.ceil(max / step) * step);
  const ticks = [];

  for (let value = axisMin; value <= axisMax + step / 2; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }

  return { min: axisMin, max: axisMax, ticks };
}

// Find where the curve crosses a constant Y value. When the graph is in
// generic-axis mode this powers the CHD reference line — but it's only
// meaningful when X is depth and Y is HV. Returns null otherwise.
export function findGenericYCrossing(
  points: AxisGraphPoint[],
  targetY: number | null
): { x: number; y: number; segmentStart: AxisGraphPoint; segmentEnd: AxisGraphPoint } | null {
  if (targetY === null || !Number.isFinite(targetY) || points.length === 0) return null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.y === targetY) {
      return { x: point.x, y: targetY, segmentStart: point, segmentEnd: point };
    }
    const next = points[index + 1];
    if (!next) continue;
    const low = Math.min(point.y, next.y);
    const high = Math.max(point.y, next.y);
    if (targetY < low || targetY > high || point.y === next.y) continue;
    const ratio = (targetY - point.y) / (next.y - point.y);
    const x = point.x + ratio * (next.x - point.x);
    return { x, y: targetY, segmentStart: point, segmentEnd: next };
  }
  return null;
}

export function findChdIntersection(
  points: DepthHvGraphPoint[],
  targetHv: number | null
): ChdIntersection | null {
  if (targetHv === null || !Number.isFinite(targetHv) || points.length === 0) return null;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.hv === targetHv) {
      return {
        depthMm: point.distanceUm / UM_PER_MM,
        distanceUm: point.distanceUm,
        hv: targetHv,
        segmentStart: point,
        segmentEnd: point,
      };
    }

    const next = points[index + 1];
    if (!next) continue;

    const low = Math.min(point.hv, next.hv);
    const high = Math.max(point.hv, next.hv);
    const crosses = targetHv >= low && targetHv <= high && point.hv !== next.hv;
    if (!crosses) continue;

    const ratio = (targetHv - point.hv) / (next.hv - point.hv);
    const distanceUm = point.distanceUm + ratio * (next.distanceUm - point.distanceUm);

    return {
      depthMm: distanceUm / UM_PER_MM,
      distanceUm,
      hv: targetHv,
      segmentStart: point,
      segmentEnd: next,
    };
  }

  return null;
}

export function buildMinorTicks(majorTicks: number[]): number[] {
  const minors: number[] = [];
  for (let index = 0; index < majorTicks.length - 1; index += 1) {
    const start = majorTicks[index];
    const step = (majorTicks[index + 1] - start) / 5;
    for (let minor = 1; minor < 5; minor += 1) minors.push(start + step * minor);
  }
  return minors;
}

export function buildSmoothPath(
  points: DepthHvGraphPoint[],
  sx: (value: number) => number,
  sy: (value: number) => number
): string {
  const coords = points.map((point) => ({ x: sx(point.distanceUm), y: sy(point.hv) }));
  if (coords.length === 1) return '';
  if (coords.length === 2) {
    return `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)} L ${coords[1].x.toFixed(2)} ${coords[1].y.toFixed(2)}`;
  }

  let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let index = 0; index < coords.length - 1; index += 1) {
    const p0 = coords[index - 1] ?? coords[index];
    const p1 = coords[index];
    const p2 = coords[index + 1];
    const p3 = coords[index + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return path;
}
