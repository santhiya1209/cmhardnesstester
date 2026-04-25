import { buildUpdateSchema } from './common.schema';
import { LineColorSettingPayloadSchema } from '../models/line-color-setting';

export const CreateLineColorSettingSchema = LineColorSettingPayloadSchema;
export const UpdateLineColorSettingSchema = buildUpdateSchema(CreateLineColorSettingSchema);

export type CreateLineColorSettingInput = typeof CreateLineColorSettingSchema._output;
export type UpdateLineColorSettingInput = typeof UpdateLineColorSettingSchema._output;
