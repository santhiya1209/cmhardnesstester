import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

export const ImageTypeSchema = z.enum(['HBW-A', 'HBW-B', 'HBW-C', 'HBW-EX', 'HV-1', 'HV-2', 'HV-3']);
export const ObjectiveForMeasureSchema = z.enum(['5X', '10X', '20X', '40X', '50X']);
export const ThresholdModeSchema = z.enum(['otsu', 'adaptive', 'manual']);

export const AutoMeasureSettingsPayloadSchema = z.object({
  smoothing: z.number().int().min(0).max(20).default(15),
  threshold: z.number().int().min(0).max(255).default(134),
  turretAfterImpress: z.boolean().default(true),
  measureAfterImpress: z.boolean().default(true),
  objectiveForMeasure: ObjectiveForMeasureSchema.default('40X'),
  // Derived legacy fields kept so the native bridge keeps working unchanged.
  imageType: ImageTypeSchema.default('HV-2'),
  thresholdMode: ThresholdModeSchema.default('manual'),
  manualThreshold: z.number().int().min(0).max(255).default(134),
  morphologyKernelSize: z.number().int().min(1).max(41).default(11),
});

export const AutoMeasureSettingsModel = AutoMeasureSettingsPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ImageType = z.infer<typeof ImageTypeSchema>;
export type ObjectiveForMeasure = z.infer<typeof ObjectiveForMeasureSchema>;
export type ThresholdMode = z.infer<typeof ThresholdModeSchema>;
export type AutoMeasureSettingsPayload = z.infer<typeof AutoMeasureSettingsPayloadSchema>;
export type AutoMeasureSettings = z.infer<typeof AutoMeasureSettingsModel>;
