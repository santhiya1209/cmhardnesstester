import { buildUpdateSchema } from './common.schema';
import { TestRecordPayloadSchema } from '../models/test-record';

export const CreateTestRecordSchema = TestRecordPayloadSchema.extend({
  createdAt: TestRecordPayloadSchema.shape.createdAt.optional(),
});

export const UpdateTestRecordSchema = buildUpdateSchema(CreateTestRecordSchema);

export type CreateTestRecordInput = typeof CreateTestRecordSchema._output;
export type UpdateTestRecordInput = typeof UpdateTestRecordSchema._output;
