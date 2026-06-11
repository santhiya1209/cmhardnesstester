import type {
  PatternGenerationRequest,
  PatternGenerationResult,
  PatternMode,
  PatternPoint,
} from '@/types/patternProgram';

/**
 * Pure pattern-generation engine. Turns a {@link PatternGenerationRequest} into
 * the ordered list of indentation coordinates (mm) the machine should visit.
 *
 * No React, no IO, no machine protocol — geometry only. The Multipoint per-mode
 * forms populate the request fields each mode needs; the whole request is also
 * what a saved program persists, so generation is identical before and after a
 * Save → Load round-trip.
 *
 * Geometry conventions (explicit, correctable assumptions — the legacy software
 * does not document these in this codebase):
 *  - X grows right, Y grows up; all distances in mm.
 *  - `firstOffset` is the gap from the reference point to the FIRST point along
 *    the travel axis; `interval` is the gap between consecutive points.
 *  - `offset` is the cross-axis line spacing for multi-line modes.
 */

/**
 * Common contract every mode generator implements: a pure function from a
 * request to a result. The {@link GENERATORS} map is keyed by every member of
 * the {@link PatternMode} union, so a missing generator is a compile error.
 */
export type PatternGenerator = (request: PatternGenerationRequest) => PatternGenerationResult;

const ok = (points: PatternPoint[]): PatternGenerationResult => ({ success: true, points });
const fail = (error: string): PatternGenerationResult => ({ success: false, points: [], error });

function point(no: number, x: number, y: number): PatternPoint {
  // Avoid -0 and floating dust from trig so the preview/table stays clean.
  const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  return { id: String(no), no, x: round(x), y: round(y) };
}

function requireRef(req: PatternGenerationRequest): { x: number; y: number } | null {
  if (req.refX === null || req.refY === null) return null;
  return { x: req.refX, y: req.refY };
}

function requireCount(n: number | null): number | null {
  if (n === null || !Number.isInteger(n) || n < 1) return null;
  return n;
}

function requirePositive(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

/** Points along +X from the reference. */
function generateHorizontal(req: PatternGenerationRequest): PatternGenerationResult {
  const ref = requireRef(req);
  if (!ref) return fail('Horizontal Mode needs a reference point (X and Y).');
  const count = requireCount(req.number);
  if (!count) return fail('Horizontal Mode needs Number (a positive integer).');
  const interval = requirePositive(req.interval);
  if (!interval) return fail('Horizontal Mode needs a positive Interval.');

  const first = req.firstOffset ?? 0;
  const points = Array.from({ length: count }, (_, i) =>
    point(i + 1, ref.x + first + i * interval, ref.y)
  );
  return ok(points);
}

/** Points along +Y from the reference. */
function generateVertical(req: PatternGenerationRequest): PatternGenerationResult {
  const ref = requireRef(req);
  if (!ref) return fail('Vertical Mode needs a reference point (X and Y).');
  const count = requireCount(req.number);
  if (!count) return fail('Vertical Mode needs Number (a positive integer).');
  const interval = requirePositive(req.interval);
  if (!interval) return fail('Vertical Mode needs a positive Interval.');

  const first = req.firstOffset ?? 0;
  const points = Array.from({ length: count }, (_, i) =>
    point(i + 1, ref.x, ref.y + first + i * interval)
  );
  return ok(points);
}

/** rows × columns grid, row-major (left→right, then up a row). */
function generateMatrix(req: PatternGenerationRequest): PatternGenerationResult {
  const ref = requireRef(req);
  if (!ref) return fail('Matrix Mode needs a reference point (X and Y).');
  const rows = requireCount(req.rows ?? null);
  const columns = requireCount(req.columns ?? null);
  if (!rows || !columns) return fail('Matrix Mode needs Rows and Columns (positive integers).');
  const intervalX = requirePositive(req.interval);
  const intervalY = requirePositive(req.intervalY ?? req.interval);
  if (!intervalX || !intervalY) return fail('Matrix Mode needs positive Interval X and Interval Y.');

  const points: PatternPoint[] = [];
  let no = 1;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      points.push(point(no, ref.x + c * intervalX, ref.y + r * intervalY));
      no += 1;
    }
  }
  return ok(points);
}

/** Operator-captured points, used verbatim. */
function generateFree(req: PatternGenerationRequest): PatternGenerationResult {
  const free = req.freePoints ?? [];
  if (free.length === 0) return fail('Free Mode needs at least one captured point.');
  const bad = free.find((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y));
  if (bad) return fail('Free Mode point list contains an invalid coordinate.');
  return ok(free.map((p, i) => point(i + 1, p.x, p.y)));
}

/**
 * Standard hardness case-depth traverse: a single straight line of indents from
 * an edge toward the core. Reference point 1 is the origin; reference point 2
 * sets the direction vector (its distance from the origin is irrelevant — only
 * the bearing is used). The distance from the origin to indent `i` (0-based) is
 * `firstOffset + offset + i * interval` along that direction.
 *
 * No parallel rows, no stagger — every point is collinear. Exactly two reference
 * points are meaningful (extras, if any, are ignored). The persisted `angle`
 * field is not used: the bearing comes solely from the two reference points.
 */
function generateCaseDepth(req: PatternGenerationRequest): PatternGenerationResult {
  const pts = req.referencePoints ?? [];
  const origin = pts[0];
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
    return fail('Case Depth Mode needs Reference Point 1 (origin) with numeric X and Y.');
  }
  const direction = pts[1];
  if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.y)) {
    return fail('Case Depth Mode needs Reference Point 2 (direction) with numeric X and Y.');
  }
  const count = requireCount(req.number);
  if (!count) return fail('Case Depth Mode needs Number (a positive integer).');
  const interval = requirePositive(req.interval);
  if (!interval) return fail('Case Depth Mode needs a positive Interval.');
  const firstOffset = req.firstOffset ?? 0;
  if (!Number.isFinite(firstOffset) || firstOffset < 0) {
    return fail('Case Depth Mode needs First Offset ≥ 0.');
  }
  const offset = req.offset ?? 0;
  if (!Number.isFinite(offset) || offset < 0) {
    return fail('Case Depth Mode needs Offset ≥ 0.');
  }

  const vx = direction.x - origin.x;
  const vy = direction.y - origin.y;
  const length = Math.hypot(vx, vy);
  if (length === 0) return fail('Case Depth Reference Point 1 and Reference Point 2 must differ to define a direction.');

  const ux = vx / length;
  const uy = vy / length;
  const start = firstOffset + offset;
  const points = Array.from({ length: count }, (_, i) => {
    const d = start + i * interval;
    return point(i + 1, origin.x + d * ux, origin.y + d * uy);
  });
  return ok(points);
}

/** `number` points evenly distributed on a circle of `radius` about the reference. */
function generateCircle(req: PatternGenerationRequest): PatternGenerationResult {
  const ref = requireRef(req);
  if (!ref) return fail('Circle Mode needs a centre reference point (X and Y).');
  const count = requireCount(req.number);
  if (!count) return fail('Circle Mode needs Number (a positive integer).');
  const radius = requirePositive(req.radius);
  if (!radius) return fail('Circle Mode needs a positive Radius.');

  const points = Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count;
    return point(i + 1, ref.x + radius * Math.cos(a), ref.y + radius * Math.sin(a));
  });
  return ok(points);
}

/** Single point: the midpoint of reference 1 and reference 2. */
function generateMidpoint(req: PatternGenerationRequest): PatternGenerationResult {
  const ref = requireRef(req);
  if (!ref) return fail('Midpoint Mode needs reference point 1 (X and Y).');
  if (req.refX2 === null || req.refX2 === undefined || req.refY2 === null || req.refY2 === undefined) {
    return fail('Midpoint Mode needs reference point 2 (X and Y).');
  }
  return ok([point(1, (ref.x + req.refX2) / 2, (ref.y + req.refY2) / 2)]);
}

/** `count` points evenly spaced (inclusive of both ends) between ref1 and ref2. */
function generateEquidistantBetween(
  req: PatternGenerationRequest,
  count: number,
  label: string
): PatternGenerationResult {
  const ref = requireRef(req);
  if (!ref) return fail(`${label} needs reference point 1 (X and Y).`);
  if (req.refX2 === null || req.refX2 === undefined || req.refY2 === null || req.refY2 === undefined) {
    return fail(`${label} needs reference point 2 (X and Y).`);
  }
  if (count === 1) return ok([point(1, ref.x, ref.y)]);

  const points = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return point(i + 1, ref.x + (req.refX2! - ref.x) * t, ref.y + (req.refY2! - ref.y) * t);
  });
  return ok(points);
}

/** Three vertices of an equilateral triangle on a circle of `radius` about the reference. */
function generateEquidistantTriangle(req: PatternGenerationRequest): PatternGenerationResult {
  const ref = requireRef(req);
  if (!ref) return fail('Equidistant Triangle Mode needs a centre reference point (X and Y).');
  const radius = requirePositive(req.radius);
  if (!radius) return fail('Equidistant Triangle Mode needs a positive Radius.');

  const points = Array.from({ length: 3 }, (_, i) => {
    // First vertex points up (+Y); vertices 120° apart.
    const a = Math.PI / 2 + (2 * Math.PI * i) / 3;
    return point(i + 1, ref.x + radius * Math.cos(a), ref.y + radius * Math.sin(a));
  });
  return ok(points);
}

/** `rows` parallel horizontal lines (spaced by `offset` in Y), each `number` points spaced by `interval` in X. */
function generateMultilineComposite(req: PatternGenerationRequest): PatternGenerationResult {
  const ref = requireRef(req);
  if (!ref) return fail('Multiline Composite Pattern needs a reference point (X and Y).');
  const lines = requireCount(req.rows ?? null);
  if (!lines) return fail('Multiline Composite Pattern needs Rows (number of lines).');
  const perLine = requireCount(req.number);
  if (!perLine) return fail('Multiline Composite Pattern needs Number (points per line).');
  const interval = requirePositive(req.interval);
  if (!interval) return fail('Multiline Composite Pattern needs a positive Interval (X spacing).');
  const lineGap = requirePositive(req.offset ?? req.intervalY);
  if (!lineGap) return fail('Multiline Composite Pattern needs a positive Offset (line spacing).');

  const first = req.firstOffset ?? 0;
  const points: PatternPoint[] = [];
  let no = 1;
  for (let r = 0; r < lines; r += 1) {
    for (let c = 0; c < perLine; c += 1) {
      points.push(point(no, ref.x + first + c * interval, ref.y + r * lineGap));
      no += 1;
    }
  }
  return ok(points);
}

/** Vertical line at refX through operator-captured Y values (X ignored, refX wins). */
function generateVerticalLineFreePoints(req: PatternGenerationRequest): PatternGenerationResult {
  if (req.refX === null) return fail('Vertical Line Free Points Mode needs a reference X.');
  const free = req.freePoints ?? [];
  if (free.length === 0) return fail('Vertical Line Free Points Mode needs at least one captured point.');
  const bad = free.find((p) => !Number.isFinite(p.y));
  if (bad) return fail('Vertical Line Free Points Mode has an invalid Y coordinate.');
  return ok(free.map((p, i) => point(i + 1, req.refX as number, p.y)));
}

const GENERATORS: Record<PatternMode, PatternGenerator> = {
  'Horizontal Mode': generateHorizontal,
  'Vertical Mode': generateVertical,
  'Matrix Mode': generateMatrix,
  'Free Mode': generateFree,
  'Case Depth Mode': generateCaseDepth,
  'Circle Mode': generateCircle,
  'Midpoint Mode': generateMidpoint,
  'Equidistant Multipoint Mode': (req) =>
    generateEquidistantBetween(req, requireCount(req.number) ?? 0, 'Equidistant Multipoint Mode'),
  'Equidistant Three Point Mode': (req) =>
    generateEquidistantBetween(req, 3, 'Equidistant Three Point Mode'),
  'Equidistant Triangle Mode': generateEquidistantTriangle,
  'Multiline Composite Pattern': generateMultilineComposite,
  'Vertical Line Free Points Mode': generateVerticalLineFreePoints,
};

/** Dispatch a generation request to the generator for its mode. */
export function generatePattern(req: PatternGenerationRequest): PatternGenerationResult {
  const generator = GENERATORS[req.mode];
  if (!generator) return fail(`Unknown pattern mode: ${req.mode}`);
  if (req.mode === 'Equidistant Multipoint Mode' && !requireCount(req.number)) {
    return fail('Equidistant Multipoint Mode needs Number (a positive integer).');
  }
  return generator(req);
}
