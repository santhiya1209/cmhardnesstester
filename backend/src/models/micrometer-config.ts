import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

export const MicrometerConfigPayloadSchema = z.object({
  enabled: z.boolean().default(true),
  // OS-reported port path the operator picked in the Micrometer dialog.
  // null means "no port selected yet" — the device stays disconnected and
  // the depth column accepts manual entry. Baud rate is fixed internally
  // (2400 8N1) so it is intentionally not part of this payload.
  comPort: z.string().trim().min(1).nullable().default(null),
});

export const MicrometerConfigModel = MicrometerConfigPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type MicrometerConfigPayload = z.infer<typeof MicrometerConfigPayloadSchema>;
export type MicrometerConfig = z.infer<typeof MicrometerConfigModel>;
