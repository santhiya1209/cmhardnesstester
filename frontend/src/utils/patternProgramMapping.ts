import type { ProgramMeta } from '@/types/multipoint';
import type {
  FreePoint,
  PatternGenerationRequest,
  PatternMode,
  PatternProgram,
  PatternProgramPayload,
  TriangleDefinition,
} from '@/types/patternProgram';

/**
 * Pure Save/Load mapping between the Redux generation config and the persisted
 * pattern-program payload. Extracted from `useMultipoint` so the round-trip can
 * be unit-tested without React/Redux. No IO, no hooks — type-only imports.
 */

const finite = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? value : null;

// Drop incomplete coordinate rows so a blank "Add Point" slot (seeded with NaN
// for smooth in-place typing) never persists as a null-coordinate point — NaN
// JSON-serialises to null, which would break the FreePoint number contract on
// reload. Fully-captured points (the only kind for Case Depth / Circle) are
// untouched, so existing round-trips are unaffected.
const finitePoints = (points: FreePoint[]): FreePoint[] =>
  (points ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

// Drop triangles with any blank/non-finite vertex so a half-entered table row
// (seeded with NaN for smooth in-place typing) never persists as null
// coordinates. Generation already ignores incomplete triangles, so this keeps
// Save consistent with what Generate would actually use.
const completeTriangles = (triangles: TriangleDefinition[]): TriangleDefinition[] =>
  (triangles ?? []).filter((t) =>
    [t.x1, t.y1, t.x2, t.y2, t.x3, t.y3].every((v) => Number.isFinite(v))
  );

// Restore the exact generation config from a saved program — every input is
// read back verbatim, so no field is defaulted or regenerated on Load.
export function configFromProgram(program: PatternProgram): PatternGenerationRequest {
  return {
    mode: program.mode,
    refX: program.refX,
    refY: program.refY,
    interval: program.interval,
    offset: program.offset,
    firstOffset: program.firstOffset,
    number: program.number,
    intervalY: program.intervalY,
    rows: program.rows,
    columns: program.columns,
    refX2: program.refX2,
    refY2: program.refY2,
    radius: program.radius,
    freePoints: program.freePoints,
    referencePoints: program.referencePoints,
    angle: program.angle,
    lines: program.lines ?? [],
    triangles: program.triangles ?? [],
  };
}

export function metaFromProgram(program: PatternProgram): ProgramMeta {
  return {
    pattern: program.pattern,
    multiset: program.multiset,
    focusAll: program.focusAll,
    impressMode: program.impressMode,
  };
}

export function toPayload(
  config: PatternGenerationRequest,
  mode: PatternMode,
  meta: ProgramMeta,
  checked: boolean
): PatternProgramPayload {
  return {
    pattern: meta.pattern,
    mode,
    refX: finite(config.refX),
    refY: finite(config.refY),
    interval: finite(config.interval),
    offset: finite(config.offset),
    firstOffset: finite(config.firstOffset),
    number: finite(config.number),
    intervalY: finite(config.intervalY),
    rows: finite(config.rows),
    columns: finite(config.columns),
    refX2: finite(config.refX2),
    refY2: finite(config.refY2),
    radius: finite(config.radius),
    freePoints: config.freePoints,
    referencePoints: finitePoints(config.referencePoints),
    angle: finite(config.angle),
    lines: config.lines ?? [],
    triangles: completeTriangles(config.triangles),
    multiset: meta.multiset,
    focusAll: meta.focusAll,
    impressMode: meta.impressMode,
    checked,
  };
}
