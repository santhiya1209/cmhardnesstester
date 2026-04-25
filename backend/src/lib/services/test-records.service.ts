import { InvalidReferenceError } from '../errors';
import type { TestRecordPayload } from '../../models/test-record';
import { TestRecordModel, type TestRecord } from '../../models/test-record';
import type { DatabaseState } from '../../models/database';
import { createCrudService } from './create-crud.service';

export type CreateTestRecordInput = Omit<TestRecordPayload, 'createdAt'> & {
  createdAt?: string;
};

export type UpdateTestRecordInput = Partial<CreateTestRecordInput>;

function assertMeasurementsExist(measurementIds: string[], database: DatabaseState): void {
  const knownMeasurementIds = new Set(database.measurements.map((measurement) => measurement.id));
  const missingMeasurementIds = measurementIds.filter((id) => !knownMeasurementIds.has(id));

  if (missingMeasurementIds.length > 0) {
    throw new InvalidReferenceError(
      'All measurementIds must reference existing measurements before a test record can be saved.',
      { missingMeasurementIds }
    );
  }
}

export const testRecordsService = createCrudService<
  TestRecord,
  CreateTestRecordInput,
  UpdateTestRecordInput
>({
  collection: 'testRecords',
  resourceName: 'Test record',
  schema: TestRecordModel,
  createEntity: (input, { id, now }) => ({
    id,
    sampleName: input.sampleName,
    testMethod: input.testMethod,
    measurementIds: input.measurementIds,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    createdAt: input.createdAt ?? current.createdAt,
    measurementIds: input.measurementIds ?? current.measurementIds,
    updatedAt: now,
  }),
  beforeCreate: (input, database) => {
    assertMeasurementsExist(input.measurementIds, database);
  },
  beforeUpdate: (_current, input, database) => {
    if (input.measurementIds) {
      assertMeasurementsExist(input.measurementIds, database);
    }
  },
});
