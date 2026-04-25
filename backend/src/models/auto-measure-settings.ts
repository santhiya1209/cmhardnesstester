import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

export const ImageTypeSchema = z.enum(['HV-1', 'HV-2', 'HV-3']);
export const ObjectiveForMeasureSchema = z.enum(['10X', '40X']);

const SliderInt = z.number().int().min(0).max(100);

export const AutoMeasureSettingsPayloadSchema = z.object({
  imageType: ImageTypeSchema,
  erosion: SliderInt,
  dilation: SliderInt,
  factor: SliderInt,
  turretAfterImpress: z.boolean(),
  measureAfterImpress: z.boolean(),
  objectiveForMeasure: ObjectiveForMeasureSchema,
});

export const AutoMeasureSettingsModel = AutoMeasureSettingsPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ImageType = z.infer<typeof ImageTypeSchema>;
export type ObjectiveForMeasure = z.infer<typeof ObjectiveForMeasureSchema>;
export type AutoMeasureSettingsPayload = z.infer<typeof AutoMeasureSettingsPayloadSchema>;
export type AutoMeasureSettings = z.infer<typeof AutoMeasureSettingsModel>;
