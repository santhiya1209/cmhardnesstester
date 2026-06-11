import type { ProgramMeta } from '@/types/multipoint';
import type {
  PatternGenerationRequest,
  PatternMode,
  PatternProgram,
  PatternProgramPayload,
} from '@/types/patternProgram';

/**
 * Pure Save/Load mapping between the Redux generation config and the persisted
 * pattern-program payload. Extracted from `useMultipoint` so the round-trip can
 * be unit-tested without React/Redux. No IO, no hooks — type-only imports.
 */

const finite = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? value : null;

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
    referencePoints: config.referencePoints,
    angle: finite(config.angle),
    multiset: meta.multiset,
    focusAll: meta.focusAll,
    impressMode: meta.impressMode,
    checked,
  };
}
