import { buildUpdateSchema } from './common.schema';
import { AutoMeasureSettingsPayloadSchema } from '../models/auto-measure-settings';

export const CreateAutoMeasureSettingsSchema = AutoMeasureSettingsPayloadSchema;
export const UpdateAutoMeasureSettingsSchema = buildUpdateSchema(AutoMeasureSettingsPayloadSchema);

export type CreateAutoMeasureSettingsInput = typeof CreateAutoMeasureSettingsSchema._output;
export type UpdateAutoMeasureSettingsInput = typeof UpdateAutoMeasureSettingsSchema._output;
