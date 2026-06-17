import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, PositiveNumberSchema } from './common';

export const MeasurementMethodSchema = z.enum(['Manual', 'Auto', 'Auto (Adjusted)']);
export const MeasurementUnitSchema = z.enum(['um', 'px']);
export const DepthSourceSchema = z.enum(['device', 'manual']);
const NullablePositiveNumberSchema = PositiveNumberSchema.nullable().default(null);
const NullableTextSchema = z.string().trim().nullable().default(null);

// Indentation diamond vertices, NORMALISED to 0..1 of the captured frame
// (x = fraction of width, y = fraction of height). Stored resolution-independent
// so the vector overlay can be repainted on a later review at ANY display size
// (the saved still is a downscaled thumbnail) — see App.reviewMultipointPoint.
export const NormalizedPointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const DiamondGeometrySchema = z.object({
  top: NormalizedPointSchema,
  right: NormalizedPointSchema,
  bottom: NormalizedPointSchema,
  left: NormalizedPointSchema,
});

export const MeasurementPayloadSchema = z.object({
  d1: PositiveNumberSchema,
  d2: PositiveNumberSchema,
  hv: PositiveNumberSchema.nullable().default(null),
  // Effective depth shown in tables/reports. Mirrors deviceDepthMm or
  // manualDepthMm depending on depthSource at the moment of save. Kept as
  // its own field so legacy rows (written before depthSource existed) still
  // render correctly.
  depthMm: z.number().finite().nullable().default(null),
  // Whether depthMm was captured from the micrometer device or typed by the
  // operator. Nullable for backward-compat with rows saved before this field
  // existed.
  depthSource: DepthSourceSchema.nullable().default(null),
  // Frozen micrometer reading at save time. Untouched by later live-stream
  // updates, line drags, or recalcs.
  deviceDepthMm: z.number().finite().nullable().default(null),
  // Operator-entered depth when the micrometer is disabled. Preserved across
  // detection re-runs.
  manualDepthMm: z.number().finite().nullable().default(null),
  method: MeasurementMethodSchema.default('Manual'),
  unit: MeasurementUnitSchema.default('um'),
  d1Px: NullablePositiveNumberSchema,
  d2Px: NullablePositiveNumberSchema,
  d1Um: NullablePositiveNumberSchema,
  d2Um: NullablePositiveNumberSchema,
  averageUm: NullablePositiveNumberSchema,
  averageMm: NullablePositiveNumberSchema,
  micronPerPixel: NullablePositiveNumberSchema,
  calibrationName: NullableTextSchema,
  // Soft reference to the calibration record used to convert this measurement
  // (calibration-settings id for live measures, calibrations id when the row
  // was created from the Add Calibration flow). Nullable for legacy rows and
  // measures taken before any calibration was matched.
  calibrationId: NullableTextSchema,
  objective: NullableTextSchema,
  testForceKgf: NullablePositiveNumberSchema,
  timestamp: IsoDateTimeSchema,
  imageDataUrl: z.string().optional(),
  // Normalised diamond vertices for sharp vector-overlay restore on point
  // review. Null/missing for manual measures and legacy rows (those fall back
  // to the baked-in overlay in imageDataUrl).
  diamond: DiamondGeometrySchema.nullable().optional(),
  xMm: z.number().finite().nullable().optional(),
  yMm: z.number().finite().nullable().optional(),
  // Computed at save time from the parent test record's targetMin/MaxHv vs
  // the measured HV. Kept as 'YES'/'NO' strings to match the table renderer's
  // existing formatQualified contract; null when no target range is set.
  qualified: z.enum(['YES', 'NO']).nullable().optional(),
  hardnessType: z.string().trim().nullable().optional(),
  // Hardness conversion target (HV/HK/HBW/HRA/HRB/HRC/...) and the converted
  // numeric value. Stored per-row so changing the dropdown for one measurement
  // does not affect older saved rows. Null/missing means no conversion saved.
  convertType: z.string().trim().nullable().optional(),
  convertValue: z.number().finite().nullable().optional(),
});

export const MeasurementModel = MeasurementPayloadSchema.extend({
  id: EntityIdSchema,
  average: PositiveNumberSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type MeasurementPayload = z.infer<typeof MeasurementPayloadSchema>;
export type Measurement = z.infer<typeof MeasurementModel>;
export type MeasurementMethod = z.infer<typeof MeasurementMethodSchema>;
export type MeasurementUnit = z.infer<typeof MeasurementUnitSchema>;
export type DepthSource = z.infer<typeof DepthSourceSchema>;
