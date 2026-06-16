import { buildUpdateSchema } from './common.schema';
import { MultipointResultPayloadSchema } from '../models/multipoint-result';

export const CreateMultipointResultSchema = MultipointResultPayloadSchema.extend({
  timestamp: MultipointResultPayloadSchema.shape.timestamp.optional(),
});

export const UpdateMultipointResultSchema = buildUpdateSchema(CreateMultipointResultSchema);

export type CreateMultipointResultInput = typeof CreateMultipointResultSchema._output;
export type UpdateMultipointResultInput = typeof UpdateMultipointResultSchema._output;
