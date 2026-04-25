import { buildUpdateSchema } from './common.schema';
import { CalibrationSettingsPayloadSchema } from '../models/calibration-settings';

export const CreateCalibrationSettingsSchema = CalibrationSettingsPayloadSchema.extend({
  calibrationDate: CalibrationSettingsPayloadSchema.shape.calibrationDate.optional(),
});

export const UpdateCalibrationSettingsSchema = buildUpdateSchema(CreateCalibrationSettingsSchema);

export type CreateCalibrationSettingsInput = typeof CreateCalibrationSettingsSchema._output;
export type UpdateCalibrationSettingsInput = typeof UpdateCalibrationSettingsSchema._output;
