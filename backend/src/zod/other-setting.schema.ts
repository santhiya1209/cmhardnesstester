import { buildUpdateSchema } from './common.schema';
import { OtherSettingPayloadSchema } from '../models/other-setting';

export const CreateOtherSettingSchema = OtherSettingPayloadSchema;
export const UpdateOtherSettingSchema = buildUpdateSchema(CreateOtherSettingSchema);

export type CreateOtherSettingInput = typeof CreateOtherSettingSchema._output;
export type UpdateOtherSettingInput = typeof UpdateOtherSettingSchema._output;
