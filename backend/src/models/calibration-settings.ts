import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  PositiveNumberSchema,
} from './common';

export const CalibrationSettingsPayloadSchema = z.object({
  objective: NonEmptyStringSchema,
  normalizedObjective: NonEmptyStringSchema.optional(),
  pixelToMicron: PositiveNumberSchema,
  umPerPixel: PositiveNumberSchema.optional(),
  pixelPerMm: PositiveNumberSchema.optional(),
  active: z.boolean().optional().default(false),
  calibrationDate: IsoDateTimeSchema,
});

export const CalibrationSettingsModel = CalibrationSettingsPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type CalibrationSettingsPayload = z.infer<typeof CalibrationSettingsPayloadSchema>;
export type CalibrationSettings = z.infer<typeof CalibrationSettingsModel>;
