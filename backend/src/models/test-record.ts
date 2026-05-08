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
  // Workpiece-level hardness specification. Each measurement under this test
  // record qualifies if HV ∈ [targetMinHv, targetMaxHv]. Optional so legacy
  // records remain valid; when absent qualified is left null.
  targetMinHv: z.number().positive().optional().nullable(),
  targetMaxHv: z.number().positive().optional().nullable(),
});

export const TestRecordModel = TestRecordPayloadSchema.extend({
  id: EntityIdSchema,
  updatedAt: IsoDateTimeSchema,
});

export type TestRecordPayload = z.infer<typeof TestRecordPayloadSchema>;
export type TestRecord = z.infer<typeof TestRecordModel>;
