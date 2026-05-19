import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

export const MicrometerConfigPayloadSchema = z.object({
  enabled: z.boolean().default(true),
});

export const MicrometerConfigModel = MicrometerConfigPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type MicrometerConfigPayload = z.infer<typeof MicrometerConfigPayloadSchema>;
export type MicrometerConfig = z.infer<typeof MicrometerConfigModel>;
