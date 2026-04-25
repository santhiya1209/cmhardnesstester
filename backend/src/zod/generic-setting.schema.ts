import { buildUpdateSchema } from './common.schema';
import { GenericSettingPayloadSchema } from '../models/generic-setting';

export const CreateGenericSettingSchema = GenericSettingPayloadSchema;
export const UpdateGenericSettingSchema = buildUpdateSchema(CreateGenericSettingSchema);

export type CreateGenericSettingInput = typeof CreateGenericSettingSchema._output;
export type UpdateGenericSettingInput = typeof UpdateGenericSettingSchema._output;
