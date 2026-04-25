import { buildUpdateSchema } from './common.schema';
import { ToolbarStatePayloadSchema } from '../models/toolbar-state';

export const CreateToolbarStateSchema = ToolbarStatePayloadSchema;
export const UpdateToolbarStateSchema = buildUpdateSchema(ToolbarStatePayloadSchema);

export type CreateToolbarStateInput = typeof CreateToolbarStateSchema._output;
export type UpdateToolbarStateInput = typeof UpdateToolbarStateSchema._output;
