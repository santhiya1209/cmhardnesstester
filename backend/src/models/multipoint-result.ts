import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';
import { DiamondGeometrySchema, NormalizedPointSchema } from './measurement';

// Per-point execution outcome for one Multipoint run. This is the RUN record
// (which point, what happened, how long), distinct from the measurements table
// which owns the metrology (HV/D1/D2). The two are linked by `measurementId`.
//
// Stored as (id, json) like every other collection. One row per executed point
// per run; `runId` groups the rows that belong to a single Start→finish run.

const NullableFiniteNumberSchema = z.number().finite().nullable().default(null);
const NullableTextSchema = z.string().trim().nullable().default(null);

// Honest focus state: real autofocus hardware does not exist yet, so a point is
// either focused by the operator manually, left to settle only, skipped, failed,
// or 'not-available' when no focus step ran. No fabricated autofocus success.
export const MultipointFocusStatusSchema = z.enum([
  'pending',
  'manual',
  'settled',
  'focused',
  'skipped',
  'failed',
  'not-available',
]);

export const MultipointIndentStatusSchema = z.enum([
  'pending',
  'indented',
  'skipped',
  'failed',
]);

export const MultipointMeasureStatusSchema = z.enum([
  'pending',
  'measured',
  'rejected',
  'skipped',
  'failed',
]);

export const MultipointResultPayloadSchema = z.object({
  // Run grouping + point identity.
  runId: z.string().trim(),
  pointNo: z.number().int().positive(),
  // Soft reference to the in-memory generated point id (selection/overlay key).
  pointId: NullableTextSchema,
  // Which impress pass produced this row (two-pass mode); null for single pass.
  pass: z.number().int().min(1).max(2).nullable().default(null),

  // Absolute machine coordinates the stage was driven to (mm).
  xMm: z.number().finite(),
  yMm: z.number().finite(),

  // Atomic-step outcomes.
  focusStatus: MultipointFocusStatusSchema.default('not-available'),
  indentStatus: MultipointIndentStatusSchema.default('pending'),
  measureStatus: MultipointMeasureStatusSchema.default('pending'),

  // Metrology snapshot (mirrors the linked measurement for convenient run export).
  hv: NullableFiniteNumberSchema,
  d1Um: NullableFiniteNumberSchema,
  d2Um: NullableFiniteNumberSchema,
  averageUm: NullableFiniteNumberSchema,
  testForceKgf: NullableFiniteNumberSchema,
  objective: NullableTextSchema,
  // Detection confidence reported by the native Vickers measure (0..1).
  confidence: NullableFiniteNumberSchema,
  // Soft reference to the measurements row that owns the full metrology.
  measurementId: NullableTextSchema,

  // Self-contained review snapshot for Indenting mode (no measurement row is
  // created without metrology). For measured points these stay null and review
  // pulls the image/geometry from the linked measurement instead.
  imageDataUrl: z.string().nullable().default(null),
  diamond: DiamondGeometrySchema.nullable().default(null),
  centerNorm: NormalizedPointSchema.nullable().default(null),

  // Operator name captured at run time (no auth system; free-text from settings).
  operator: NullableTextSchema,
  // Wall-clock duration of this point's atomic operations (ms).
  durationMs: NullableFiniteNumberSchema,
  timestamp: IsoDateTimeSchema,
});

export const MultipointResultModel = MultipointResultPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type MultipointResultPayload = z.infer<typeof MultipointResultPayloadSchema>;
export type MultipointResult = z.infer<typeof MultipointResultModel>;
export type MultipointFocusStatus = z.infer<typeof MultipointFocusStatusSchema>;
export type MultipointIndentStatus = z.infer<typeof MultipointIndentStatusSchema>;
export type MultipointMeasureStatus = z.infer<typeof MultipointMeasureStatusSchema>;
