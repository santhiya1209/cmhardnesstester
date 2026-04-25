import { buildUpdateSchema } from './common.schema';
import { DepthImageSettingPayloadSchema } from '../models/depth-image-setting';

export const CreateDepthImageSettingSchema = DepthImageSettingPayloadSchema;
export const UpdateDepthImageSettingSchema = buildUpdateSchema(DepthImageSettingPayloadSchema);

export type CreateDepthImageSettingInput = typeof CreateDepthImageSettingSchema._output;
export type UpdateDepthImageSettingInput = typeof UpdateDepthImageSettingSchema._output;
