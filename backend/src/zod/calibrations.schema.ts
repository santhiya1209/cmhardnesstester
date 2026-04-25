import { z } from 'zod';
import { buildUpdateSchema } from './common.schema';
import { CalibrationPayloadSchema } from '../models/calibration';

export const CreateCalibrationSchema = CalibrationPayloadSchema.extend({
  createdAt: CalibrationPayloadSchema.shape.createdAt.optional(),
});

export const UpdateCalibrationSchema = buildUpdateSchema(CreateCalibrationSchema);

export const ImportCalibrationsSchema = z.object({
  items: z.array(CreateCalibrationSchema),
  replace: z.boolean().optional(),
});

export type CreateCalibrationInput = typeof CreateCalibrationSchema._output;
export type UpdateCalibrationInput = typeof UpdateCalibrationSchema._output;
export type ImportCalibrationsInput = typeof ImportCalibrationsSchema._output;
