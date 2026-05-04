import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, PositiveNumberSchema } from './common';

export const MeasurementMethodSchema = z.enum(['Manual', 'Auto', 'Auto (Adjusted)']);
export const MeasurementUnitSchema = z.enum(['um', 'px']);
const NullablePositiveNumberSchema = PositiveNumberSchema.nullable().default(null);
const NullableTextSchema = z.string().trim().nullable().default(null);

export const MeasurementPayloadSchema = z.object({
  d1: PositiveNumberSchema,
  d2: PositiveNumberSchema,
  hv: PositiveNumberSchema.nullable().default(null),
  depthMm: z.number().finite().nullable().default(null),
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
  objective: NullableTextSchema,
  testForceKgf: NullablePositiveNumberSchema,
  timestamp: IsoDateTimeSchema,
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
