import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, NonEmptyStringSchema } from './common';

export const PatternSchema = z.enum(['Line', 'Rectangle', 'Circle', 'Custom']);
export const PatternModeSchema = z.enum([
  'Horizontal Mode',
  'Horizontal Capture Mode',
  'Vertical Mode',
  'Case Depth Mode',
  'Free Mode',
  'Matrix Mode',
  'Circle Mode',
  'Midpoint Mode',
  'Equidistant Multipoint Mode',
  'Equidistant Three Point Mode',
  'Equidistant Triangle Mode',
  'Multiline Composite Pattern',
  'Vertical Line Free Points Mode',
]);
export const ImpressModeSchema = z.enum(['indenting', 'onePass', 'twoPass']);

const NullableFiniteNumberSchema = z.number().finite().nullable();
const NullableNonNegativeNumberSchema = z.number().finite().nonnegative().nullable();
const NullableNonNegativeIntegerSchema = z.number().int().nonnegative().nullable();

// A captured / entered coordinate pair, persisted verbatim for Free and
// Vertical-Line-Free modes so the point list round-trips exactly.
export const FreePointSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const CompositeMoveSchema = z.enum(['Horizontal', 'Vertical', 'Diagonal', 'Custom']);

// One MultiLine Composite line, persisted verbatim so the multi-line layout
// round-trips on Load. Generation semantics (Start→End span ÷ interval) live in
// utils/patternGeneration.ts, not here.
export const CompositeLineSchema = z.object({
  id: z.string().min(1),
  move: CompositeMoveSchema,
  startX: z.number().finite(),
  startY: z.number().finite(),
  endX: z.number().finite(),
  endY: z.number().finite(),
  interval: z.number().finite().nonnegative(),
  offset: z.number().finite().nonnegative(),
  firstOffset: z.number().finite().nonnegative(),
});

// A generated indentation point, persisted verbatim so Load restores the exact
// preview/overlay/execution list without re-running Generate. `line`/`triangle`
// tag the source for MultiLine Composite / Equidistant Triangle modes only.
export const PatternPointSchema = z.object({
  id: z.string().min(1),
  no: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  line: z.number().int().positive().optional(),
  triangle: z.number().int().positive().optional(),
});

// One Equidistant Triangle definition, persisted verbatim so the triangle layout
// round-trips on Load. Without this the frontend's `triangles` payload field was
// silently stripped by zod, so Equidistant Triangle programs reloaded empty.
export const TriangleDefinitionSchema = z.object({
  id: z.string().min(1),
  x1: z.number().finite(),
  y1: z.number().finite(),
  x2: z.number().finite(),
  y2: z.number().finite(),
  x3: z.number().finite(),
  y3: z.number().finite(),
});

export const PatternProgramPayloadSchema = z.object({
  pattern: PatternSchema,
  mode: PatternModeSchema,
  refX: NullableFiniteNumberSchema,
  refY: NullableFiniteNumberSchema,
  interval: NullableNonNegativeNumberSchema,
  offset: NullableNonNegativeNumberSchema,
  firstOffset: NullableNonNegativeNumberSchema,
  number: NullableNonNegativeIntegerSchema,
  // Per-mode generation inputs — persisted so every PatternMode reconstructs
  // its exact geometry on Load (see the per-mode audit in useMultipoint).
  intervalY: NullableNonNegativeNumberSchema,
  rows: NullableNonNegativeIntegerSchema,
  columns: NullableNonNegativeIntegerSchema,
  refX2: NullableFiniteNumberSchema,
  refY2: NullableFiniteNumberSchema,
  radius: NullableNonNegativeNumberSchema,
  freePoints: z.array(FreePointSchema),
  // Case Depth inputs — persisted so the traverse round-trips on Load. Range
  // checks (angle 0–360 etc.) live in utils/patternGeneration.ts, not here.
  referencePoints: z.array(FreePointSchema),
  angle: NullableFiniteNumberSchema,
  // MultiLine Composite per-line definitions. Defaulted so programs saved
  // before this mode existed still load (they parse to an empty line list).
  lines: z.array(CompositeLineSchema).default([]),
  // Equidistant Triangle per-triangle definitions. Defaulted so programs saved
  // before this field existed still load (empty list).
  triangles: z.array(TriangleDefinitionSchema).default([]),
  // Generated points, persisted so Load restores them without pressing Generate.
  // Defaulted so programs saved before this field existed still load (empty list).
  points: z.array(PatternPointSchema).default([]),
  multiset: z.boolean(),
  focusAll: z.boolean(),
  impressMode: ImpressModeSchema,
  checked: z.boolean(),
});

export const PatternProgramModel = PatternProgramPayloadSchema.extend({
  id: EntityIdSchema,
  patternName: NonEmptyStringSchema,
  pointCount: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type PatternProgramPayload = z.infer<typeof PatternProgramPayloadSchema>;
export type PatternProgram = z.infer<typeof PatternProgramModel>;
