import { buildUpdateSchema } from './common.schema';
import { XYZPlatformStatePayloadSchema } from '../models/xyz-platform-state';

export const CreateXYZPlatformStateSchema = XYZPlatformStatePayloadSchema;
export const UpdateXYZPlatformStateSchema = buildUpdateSchema(XYZPlatformStatePayloadSchema);

export type CreateXYZPlatformStateInput = typeof CreateXYZPlatformStateSchema._output;
export type UpdateXYZPlatformStateInput = typeof UpdateXYZPlatformStateSchema._output;
