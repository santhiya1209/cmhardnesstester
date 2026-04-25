import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
} from './common';

export const CalibrationTypeSchema = z.enum(['hardness', 'length']);
export const LengthModeSchema = z.enum(['linear', 'plane']);

export const CalibrationPayloadSchema = z.object({
  zoomTime: NonEmptyStringSchema,
  force: NonEmptyStringSchema,
  hardnessLevel: NonEmptyStringSchema,
  pixelLengthX: NonNegativeNumberSchema,
  pixelLengthY: NonNegativeNumberSchema,
  hardness: NonNegativeNumberSchema,
  calibrationType: CalibrationTypeSchema,
  lengthMode: LengthModeSchema.optional(),
  realDistanceX: NonNegativeNumberSchema.optional(),
  realDistanceY: NonNegativeNumberSchema.optional(),
  createdAt: IsoDateTimeSchema,
});

export const CalibrationModel = CalibrationPayloadSchema.extend({
  id: EntityIdSchema,
  updatedAt: IsoDateTimeSchema,
});

export type CalibrationType = z.infer<typeof CalibrationTypeSchema>;
export type LengthMode = z.infer<typeof LengthModeSchema>;
export type CalibrationPayload = z.infer<typeof CalibrationPayloadSchema>;
export type Calibration = z.infer<typeof CalibrationModel>;
