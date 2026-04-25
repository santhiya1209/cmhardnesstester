import { buildUpdateSchema } from './common.schema';
import { PatternProgramPayloadSchema } from '../models/pattern-program';

export const CreatePatternProgramSchema = PatternProgramPayloadSchema;
export const UpdatePatternProgramSchema = buildUpdateSchema(PatternProgramPayloadSchema);

export type CreatePatternProgramInput = typeof CreatePatternProgramSchema._output;
export type UpdatePatternProgramInput = typeof UpdatePatternProgramSchema._output;
