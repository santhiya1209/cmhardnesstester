import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, NonEmptyStringSchema } from './common';

export const ToolbarStatePayloadSchema = z.object({
  lastAction: NonEmptyStringSchema,
});

export const ToolbarStateModel = ToolbarStatePayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ToolbarStatePayload = z.infer<typeof ToolbarStatePayloadSchema>;
export type ToolbarState = z.infer<typeof ToolbarStateModel>;
