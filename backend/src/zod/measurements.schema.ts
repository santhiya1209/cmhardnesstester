import { buildUpdateSchema } from './common.schema';
import { MeasurementPayloadSchema } from '../models/measurement';

export const CreateMeasurementSchema = MeasurementPayloadSchema.extend({
  timestamp: MeasurementPayloadSchema.shape.timestamp.optional(),
});

export const UpdateMeasurementSchema = buildUpdateSchema(CreateMeasurementSchema);

export type CreateMeasurementInput = typeof CreateMeasurementSchema._output;
export type UpdateMeasurementInput = typeof UpdateMeasurementSchema._output;
