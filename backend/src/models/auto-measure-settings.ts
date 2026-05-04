import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

export const ImageTypeSchema = z.enum(['HV-1', 'HV-2', 'HV-3']);
export const ObjectiveForMeasureSchema = z.enum(['10X', '40X']);
export const ThresholdModeSchema = z.enum(['otsu', 'adaptive', 'manual']);

const SliderInt = z.number().int().min(0).max(100);
const PositiveSliderInt = z.number().int().min(1).max(100);

export const AutoMeasureSettingsPayloadSchema = z.object({
  imageType: ImageTypeSchema.default('HV-2'),
  erosionIterations: z.number().int().min(0).max(8).default(1),
  dilationIterations: z.number().int().min(0).max(8).default(1),
  morphologyKernelSize: z.number().int().min(1).max(41).default(5),
  thresholdMode: ThresholdModeSchema.default('otsu'),
  manualThreshold: z.number().int().min(0).max(255).default(118),
  edgeFactor: SliderInt.default(38),
  minContourArea: z.number().finite().min(0.001).max(10).default(0.004),
  maxContourArea: z.number().finite().min(0.01).max(70).default(24),
  centerBias: SliderInt.default(40),
  sideFitRoiWidth: PositiveSliderInt.default(28),
  gradientStrengthFactor: SliderInt.default(36),
  turretAfterImpress: z.boolean().default(true),
  measureAfterImpress: z.boolean().default(true),
  objectiveForMeasure: ObjectiveForMeasureSchema.default('40X'),
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
