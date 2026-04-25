import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, PositiveNumberSchema } from './common';

export const MeasurementPayloadSchema = z.object({
  d1: PositiveNumberSchema,
  d2: PositiveNumberSchema,
  hv: PositiveNumberSchema,
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
