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
