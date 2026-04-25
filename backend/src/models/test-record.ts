import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  uniqueStringArraySchema,
} from './common';

export const TestRecordPayloadSchema = z.object({
  sampleName: NonEmptyStringSchema,
  testMethod: NonEmptyStringSchema,
  measurementIds: uniqueStringArraySchema(EntityIdSchema),
  createdAt: IsoDateTimeSchema,
});

export const TestRecordModel = TestRecordPayloadSchema.extend({
  id: EntityIdSchema,
  updatedAt: IsoDateTimeSchema,
});

export type TestRecordPayload = z.infer<typeof TestRecordPayloadSchema>;
export type TestRecord = z.infer<typeof TestRecordModel>;
