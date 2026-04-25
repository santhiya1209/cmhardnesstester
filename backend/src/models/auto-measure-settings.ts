import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  PositiveNumberSchema,
} from './common';

export const AutoMeasureSettingsPayloadSchema = z.object({
  claheClipLimit: PositiveNumberSchema,
  blurKernel: z.number().int().positive(),
  thresholdMode: NonEmptyStringSchema,
  morphKernel: z.number().int().positive(),
  minGradient: NonNegativeNumberSchema,
  confidenceThreshold: z.number().finite().min(0).max(1),
});

export const AutoMeasureSettingsModel = AutoMeasureSettingsPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type AutoMeasureSettingsPayload = z.infer<typeof AutoMeasureSettingsPayloadSchema>;
export type AutoMeasureSettings = z.infer<typeof AutoMeasureSettingsModel>;
