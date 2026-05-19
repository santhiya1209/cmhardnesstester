import { buildUpdateSchema } from './common.schema';
import { MicrometerConfigPayloadSchema } from '../models/micrometer-config';

export const CreateMicrometerConfigSchema = MicrometerConfigPayloadSchema;
export const UpdateMicrometerConfigSchema = buildUpdateSchema(MicrometerConfigPayloadSchema);

export type CreateMicrometerConfigInput = typeof CreateMicrometerConfigSchema._output;
export type UpdateMicrometerConfigInput = typeof UpdateMicrometerConfigSchema._output;
