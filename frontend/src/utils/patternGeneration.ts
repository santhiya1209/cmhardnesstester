import type {
  CompositeLine,
  FreePoint,
  PatternGenerationRequest,
  PatternGenerationResult,
  PatternMode,
  PatternPoint,
  TriangleDefinition,
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

/**
 * Circle Mode: the operator sets the Circle Center (referencePoints[0]) and
 * captures one point on the circumference (referencePoints[1]); the radius is
 * their distance. `number` indents are placed starting at `angle` degrees
 * (measured from +X, CCW since Y grows up) and stepped by `interval` degrees
 * around that circle — so `number × interval < 360` yields a partial arc.
 */
function generateCircle(req: PatternGenerationRequest): PatternGenerationResult {
  const pts = req.referencePoints ?? [];
  const center = pts[0];
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return fail('Circle Mode needs a Circle Center with numeric X and Y.');
  }
  const edge = pts[1];
  if (!edge || !Number.isFinite(edge.x) || !Number.isFinite(edge.y)) {
    return fail('Circle Mode needs a Reference point on the circle to set the radius.');
  }
  const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
  if (radius <= 0) return fail('Circle Center and Reference point must differ to define a radius.');
  const count = requireCount(req.number);
  if (!count) return fail('Circle Mode needs Number (a positive integer).');
  const interval = requirePositive(req.interval);
  if (!interval) return fail('Circle Mode needs a positive Interval (degrees between points).');
  const start = req.angle ?? 0;
  if (!Number.isFinite(start)) return fail('Circle Mode needs a numeric Angle (start, in degrees).');

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const points = Array.from({ length: count }, (_, i) => {
    const a = toRad(start + i * interval);
    return point(i + 1, center.x + radius * Math.cos(a), center.y + radius * Math.sin(a));
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


/**
 * Equidistant Multipoint Mode: equal-spacing point generation across an arbitrary
 * list of operator-defined reference points (`req.referencePoints`, in order).
 * `req.number` is the count of points PER segment (endpoints inclusive), so the
 * documented two-reference case — (10,10)→(110,10) with Number 11 — yields
 * (10,10),(20,10)…(110,10).
 *
 *  - `multiset` false (default): one chained polyline P1→P2→…→Pn. Each leg gets
 *    `number` points; the vertex shared between consecutive legs is emitted once.
 *  - `multiset` true: references are read as consecutive disjoint pairs
 *    (Set 1: P1→P2, Set 2: P3→P4, …); each pair is its own independent line of
 *    `number` points. A trailing unpaired reference is ignored.
 *
 * Incomplete reference slots (non-finite X or Y) are filtered out first, so a
 * blank "Add Point" row never breaks generation.
 */
function generateEquidistantMultipoint(
  req: PatternGenerationRequest,
  multiset: boolean
): PatternGenerationResult {
  const refs = (req.referencePoints ?? []).filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  );
  if (refs.length < 2) {
    return fail('Equidistant Multipoint Mode needs at least two reference points (X and Y).');
  }
  const count = requireCount(req.number);
  if (!count) return fail('Equidistant Multipoint Mode needs Number (a positive integer).');
  if (count < 2) {
    return fail('Equidistant Multipoint Mode needs Number ≥ 2 (points per segment, endpoints included).');
  }

  // `count` points from a to b, both endpoints included.
  const segment = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    });

  const points: PatternPoint[] = [];
  let no = 1;

  if (multiset) {
    const pairs = Math.floor(refs.length / 2);
    if (pairs === 0) return fail('Multiset needs at least one complete pair of reference points.');
    for (let s = 0; s < pairs; s += 1) {
      const a = refs[2 * s];
      const b = refs[2 * s + 1];
      if (a.x === b.x && a.y === b.y) {
        return fail(`Multiset Set ${s + 1} reference points must differ.`);
      }
      for (const p of segment(a, b)) {
        points.push(point(no, p.x, p.y));
        no += 1;
      }
    }
    return ok(points);
  }

  for (let leg = 0; leg + 1 < refs.length; leg += 1) {
    const a = refs[leg];
    const b = refs[leg + 1];
    if (a.x === b.x && a.y === b.y) {
      return fail(`Reference points ${leg + 1} and ${leg + 2} must differ.`);
    }
    const pts = segment(a, b);
    // Skip the first point of every leg after the first: it is the same shared
    // vertex emitted as the previous leg's last point.
    for (let i = leg === 0 ? 0 : 1; i < pts.length; i += 1) {
      points.push(point(no, pts[i].x, pts[i].y));
      no += 1;
    }
  }
  return ok(points);
}

const THREE_POINT_EPS = 1e-9;

/**
 * Points along one leg a→b: a point every `interval` mm starting at `a`, with
 * BOTH endpoints forced — the leg's start and end vertices are always indented,
 * even when the final gap is shorter than `interval`. Returns null for a
 * zero-length leg.
 */
function threePointLeg(
  a: { x: number; y: number },
  b: { x: number; y: number },
  interval: number
): { x: number; y: number }[] | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= 0) return null;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const out: { x: number; y: number }[] = [];
  for (let d = 0; d < length - THREE_POINT_EPS; d += interval) {
    out.push({ x: a.x + ux * d, y: a.y + uy * d });
  }
  out.push({ x: b.x, y: b.y }); // force the leg endpoint
  return out;
}

/**
 * Equidistant Three Point Mode: an editable table of rows, each row holding three
 * reference points P1, P2, P3 (stored flat in `req.referencePoints`, 3 slots per
 * row). Each row is generated independently and concatenated in table order with
 * continuous numbering; every emitted point carries its 1-based row number in
 * `line` so the preview/overlay can group and connect each row.
 *
 * Spacing walks each leg at `interval` mm with both endpoints forced (see
 * {@link threePointLeg}):
 *  - `multiset` false (default): the row is one chained polyline P1→P2→P3; the
 *    shared vertex P2 is emitted once (leg B drops its first point).
 *  - `multiset` true: the legs P1→P2 and P2→P3 stay as separate grouped segments
 *    (P2 emitted at the end of leg A and the start of leg B). Execution remains a
 *    single sequential pass — only the grouping differs.
 *
 * Rows with any non-finite coordinate are skipped; at least one complete row
 * (X1, Y1, X2, Y2, X3, Y3) is required.
 */
function generateEquidistantThreePoint(
  req: PatternGenerationRequest,
  multiset: boolean
): PatternGenerationResult {
  const interval = requirePositive(req.interval);
  if (!interval) return fail('Equidistant Three Point Mode needs a positive Interval.');

  const refs = req.referencePoints ?? [];
  const rows: [FreePoint, FreePoint, FreePoint][] = [];
  for (let i = 0; i + 2 < refs.length; i += 3) {
    const trio = [refs[i], refs[i + 1], refs[i + 2]];
    if (trio.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
      rows.push([trio[0], trio[1], trio[2]]);
    }
  }
  if (rows.length === 0) {
    return fail('Equidistant Three Point Mode needs at least one complete row (X1, Y1, X2, Y2, X3, Y3).');
  }

  const points: PatternPoint[] = [];
  let no = 1;
  for (let r = 0; r < rows.length; r += 1) {
    const [p1, p2, p3] = rows[r];
    const legA = threePointLeg(p1, p2, interval);
    const legB = threePointLeg(p2, p3, interval);
    if (!legA || !legB) {
      return fail(`Row ${r + 1}: P1, P2 and P3 must differ (a leg has zero length).`);
    }
    const rowPoints = multiset ? [...legA, ...legB] : [...legA, ...legB.slice(1)];
    for (const p of rowPoints) {
      points.push({ ...point(no, p.x, p.y), line: r + 1 });
      no += 1;
    }
  }
  return ok(points);
}

/** All six vertex coordinates are finite. */
function triangleComplete(t: TriangleDefinition): boolean {
  return [t.x1, t.y1, t.x2, t.y2, t.x3, t.y3].every((v) => Number.isFinite(v));
}

/**
 * A triangle is valid for generation when it is complete, has three distinct
 * vertices, and a non-zero area (i.e. the points are not collinear). Exported so
 * the editor can flag "Invalid Triangle Geometry" with the same rule generation
 * enforces.
 */
export function triangleIsValid(t: TriangleDefinition): boolean {
  if (!triangleComplete(t)) return false;
  const dup =
    (t.x1 === t.x2 && t.y1 === t.y2) ||
    (t.x2 === t.x3 && t.y2 === t.y3) ||
    (t.x1 === t.x3 && t.y1 === t.y3);
  if (dup) return false;
  // Twice the signed area; zero ⇒ collinear.
  const area2 = (t.x2 - t.x1) * (t.y3 - t.y1) - (t.x3 - t.x1) * (t.y2 - t.y1);
  return Math.abs(area2) > 1e-9;
}

/**
 * Equidistant Triangle Mode: one or more triangles (`req.triangles`), each given
 * by three explicit vertices. Equidistant points are placed along the three
 * edges P1→P2, P2→P3, P3→P1 at `interval`-mm spacing. Each corner is emitted
 * exactly once — as the start of its edge — so corners are never duplicated
 * where two edges meet. `multiset` false generates only the first complete
 * triangle; true generates every complete triangle, numbered sequentially with a
 * `triangle` tag on each point. Incomplete (blank-vertex) triangles are skipped.
 */
function generateTriangleEdges(req: PatternGenerationRequest, multiset: boolean): PatternGenerationResult {
  const interval = requirePositive(req.interval);
  if (!interval) return fail('Equidistant Triangle Mode needs a positive Interval (mm).');

  const complete = (req.triangles ?? []).filter(triangleComplete);
  if (complete.length === 0) {
    return fail('Equidistant Triangle Mode needs at least one triangle with three numeric vertices.');
  }
  const selected = multiset ? complete : [complete[0]];
  if (selected.some((t) => !triangleIsValid(t))) {
    return fail('Invalid Triangle Geometry');
  }

  const points: PatternPoint[] = [];
  let no = 1;
  selected.forEach((t, triIndex) => {
    const verts = [
      { x: t.x1, y: t.y1 },
      { x: t.x2, y: t.y2 },
      { x: t.x3, y: t.y3 },
    ];
    const tag = triIndex + 1;
    for (let e = 0; e < 3; e += 1) {
      const start = verts[e];
      const end = verts[(e + 1) % 3];
      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      const ux = (end.x - start.x) / dist;
      const uy = (end.y - start.y) / dist;
      // Start corner, then strictly-interior samples. The end corner is omitted
      // here and emitted as the next edge's start, so shared corners appear once.
      points.push({ ...point(no, start.x, start.y), triangle: tag });
      no += 1;
      for (let k = 1; k * interval < dist - 1e-9; k += 1) {
        points.push({ ...point(no, start.x + ux * k * interval, start.y + uy * k * interval), triangle: tag });
        no += 1;
      }
    }
  });
  return ok(points);
}

const COMPOSITE_EPS = 1e-9;

/**
 * Direction + extent for one composite line. The `move` constrains which axis
 * the line runs along; Horizontal/Vertical collapse the irrelevant axis so a
 * sloppy End on the other axis is ignored, while Diagonal/Custom use the full
 * Start→End vector. Returns null for a zero-length line.
 */
function compositeLineVector(line: CompositeLine): { ux: number; uy: number; length: number } | null {
  let dx: number;
  let dy: number;
  if (line.move === 'Horizontal') {
    dx = line.endX - line.startX;
    dy = 0;
  } else if (line.move === 'Vertical') {
    dx = 0;
    dy = line.endY - line.startY;
  } else {
    dx = line.endX - line.startX;
    dy = line.endY - line.startY;
  }
  const length = Math.hypot(dx, dy);
  if (length <= 0) return null;
  return { ux: dx / length, uy: dy / length, length };
}

/** Points along one composite line: Start→End in `interval`-mm steps (count derived from the span). */
function generateCompositeLine(line: CompositeLine): { x: number; y: number }[] | null {
  if (
    !Number.isFinite(line.startX) ||
    !Number.isFinite(line.startY) ||
    !Number.isFinite(line.endX) ||
    !Number.isFinite(line.endY)
  ) {
    return null;
  }
  const interval = requirePositive(line.interval);
  if (!interval) return null;
  const vector = compositeLineVector(line);
  if (!vector) return null;
  const start = (line.firstOffset ?? 0) + (line.offset ?? 0);
  if (start < 0 || start > vector.length + COMPOSITE_EPS) return null;

  const out: { x: number; y: number }[] = [];
  for (let d = start; d <= vector.length + COMPOSITE_EPS; d += interval) {
    out.push({ x: line.startX + vector.ux * d, y: line.startY + vector.uy * d });
  }
  return out;
}

/** Number of points one composite line would generate (0 if it is incomplete). */
export function compositeLinePointCount(line: CompositeLine): number {
  const segment = generateCompositeLine(line);
  return segment ? segment.length : 0;
}

/**
 * MultiLine Composite: a list of independent lines, each generated from its own
 * Start/End/Move/Interval and concatenated in table order. Every emitted point
 * carries its 1-based source line number so the preview and camera overlay can
 * group and label by line. `multiset` is persisted but does not alter order —
 * execution is a single sequential pass.
 */
function generateMultilineComposite(req: PatternGenerationRequest): PatternGenerationResult {
  const lines = req.lines ?? [];
  if (lines.length === 0) return fail('MultiLine Composite Pattern needs at least one line.');

  const points: PatternPoint[] = [];
  let no = 1;
  for (let i = 0; i < lines.length; i += 1) {
    const segment = generateCompositeLine(lines[i]);
    if (segment === null || segment.length === 0) {
      return fail(`Line ${i + 1} is incomplete — set Start, End (giving a non-zero span) and a positive Interval.`);
    }
    for (const p of segment) {
      points.push({ ...point(no, p.x, p.y), line: i + 1 });
      no += 1;
    }
  }
  return ok(points);
}

/**
 * Tolerance (mm) within which the X spread of a vertical-line point list is
 * still considered "aligned". Beyond it the editor warns the operator but still
 * allows an explicit override — generation itself never enforces alignment.
 */
export const VERTICAL_ALIGNMENT_TOLERANCE_MM = 0.5;

/**
 * True when every entered point shares (within tolerance) the same X, i.e. the
 * list really forms a vertical line. Points with a non-finite X are ignored;
 * fewer than two finite-X points is trivially aligned.
 */
export function arePointsVerticallyAligned(
  points: FreePoint[],
  toleranceMm: number = VERTICAL_ALIGNMENT_TOLERANCE_MM
): boolean {
  const xs = (points ?? []).map((p) => p.x).filter((x) => Number.isFinite(x));
  if (xs.length < 2) return true;
  return Math.max(...xs) - Math.min(...xs) <= toleranceMm;
}

/**
 * Vertical Line Free Points Mode: the operator enters X and Y per row. Unlike
 * the interval modes there is no spacing maths — the entered points are used
 * directly, only re-ordered by ascending Y so execution runs bottom→top
 * regardless of entry order. X-alignment is an editor-level warning (see
 * {@link arePointsVerticallyAligned}), not a generation constraint.
 */
function generateVerticalLineFreePoints(req: PatternGenerationRequest): PatternGenerationResult {
  const free = req.freePoints ?? [];
  if (free.length === 0) return fail('Vertical Line Free Points Mode needs at least one point.');
  const bad = free.find((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y));
  if (bad) return fail('Vertical Line Free Points Mode has an invalid coordinate.');
  const sorted = [...free].sort((a, b) => a.y - b.y);
  return ok(sorted.map((p, i) => point(i + 1, p.x, p.y)));
}

const GENERATORS: Record<PatternMode, PatternGenerator> = {
  'Horizontal Mode': generateHorizontal,
  'Vertical Mode': generateVertical,
  'Matrix Mode': generateMatrix,
  'Free Mode': generateFree,
  'Case Depth Mode': generateCaseDepth,
  'Circle Mode': generateCircle,
  'Midpoint Mode': generateMidpoint,
  // Routed through generatePattern (which threads the `multiset` option); this
  // map entry keeps the PatternMode record exhaustive and is the chained default.
  'Equidistant Multipoint Mode': (req) => generateEquidistantMultipoint(req, false),
  // Routed through generatePattern (which threads the `multiset` option); this
  // map entry keeps the PatternMode record exhaustive and is the chained default.
  'Equidistant Three Point Mode': (req) => generateEquidistantThreePoint(req, false),
  // Routed through generatePattern (which threads the `multiset` option); this
  // map entry keeps the PatternMode record exhaustive and is the single-triangle default.
  'Equidistant Triangle Mode': (req) => generateTriangleEdges(req, false),
  'Multiline Composite Pattern': generateMultilineComposite,
  'Vertical Line Free Points Mode': generateVerticalLineFreePoints,
};

/**
 * Dispatch a generation request to the generator for its mode. `options.multiset`
 * is the only meta value generation needs (Equidistant Multipoint groups its
 * references into pairs when set); every other mode ignores it.
 */
export function generatePattern(
  req: PatternGenerationRequest,
  options?: { multiset?: boolean }
): PatternGenerationResult {
  if (req.mode === 'Equidistant Multipoint Mode') {
    return generateEquidistantMultipoint(req, options?.multiset ?? false);
  }
  if (req.mode === 'Equidistant Three Point Mode') {
    return generateEquidistantThreePoint(req, options?.multiset ?? false);
  }
  if (req.mode === 'Equidistant Triangle Mode') {
    return generateTriangleEdges(req, options?.multiset ?? false);
  }
  const generator = GENERATORS[req.mode];
  if (!generator) return fail(`Unknown pattern mode: ${req.mode}`);
  return generator(req);
}
