import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, NonEmptyStringSchema } from './common';

export const DepthImageSettingPayloadSchema = z.object({
  hardnessImage: z.boolean(),
  previewLabel: NonEmptyStringSchema,
});

export const DepthImageSettingModel = DepthImageSettingPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type DepthImageSettingPayload = z.infer<typeof DepthImageSettingPayloadSchema>;
export type DepthImageSetting = z.infer<typeof DepthImageSettingModel>;
