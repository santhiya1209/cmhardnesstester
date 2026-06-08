import { buildUpdateSchema } from './common.schema';
import { XYZPlatformSettingsPayloadSchema } from '../models/xyz-platform-settings';

export const CreateXYZPlatformSettingsSchema = XYZPlatformSettingsPayloadSchema;
export const UpdateXYZPlatformSettingsSchema = buildUpdateSchema(XYZPlatformSettingsPayloadSchema);

export type CreateXYZPlatformSettingsInput = typeof CreateXYZPlatformSettingsSchema._output;
export type UpdateXYZPlatformSettingsInput = typeof UpdateXYZPlatformSettingsSchema._output;
