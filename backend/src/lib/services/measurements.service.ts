import { ConflictError } from '../errors';
import type { MeasurementPayload } from '../../models/measurement';
import { MeasurementModel, type Measurement } from '../../models/measurement';
import { createCrudService } from './create-crud.service';

export type CreateMeasurementInput = Omit<MeasurementPayload, 'timestamp'> & {
  timestamp?: string;
};

export type UpdateMeasurementInput = Partial<CreateMeasurementInput>;

function computeAverage(d1: number, d2: number): number {
  return Number(((d1 + d2) / 2).toFixed(4));
}

export const measurementsService = createCrudService<
  Measurement,
  CreateMeasurementInput,
  UpdateMeasurementInput
>({
  collection: 'measurements',
  resourceName: 'Measurement',
  schema: MeasurementModel,
  createEntity: (input, { id, now }) => {
    const timestamp = input.timestamp ?? now;
    const average = computeAverage(input.d1, input.d2);

    return {
      id,
      d1: input.d1,
      d2: input.d2,
      average,
      hv: input.hv ?? null,
      depthMm: input.depthMm ?? null,
      method: input.method ?? 'Manual',
      unit: input.unit ?? 'um',
      timestamp,
      createdAt: now,
      updatedAt: now,
    };
  },
  updateEntity: (current, input, { now }) => {
    const d1 = input.d1 ?? current.d1;
    const d2 = input.d2 ?? current.d2;
    const hv = input.hv === undefined ? current.hv : input.hv;
    const depthMm = input.depthMm === undefined ? current.depthMm ?? null : input.depthMm;

    return {
      ...current,
      ...input,
      d1,
      d2,
      average: computeAverage(d1, d2),
      hv,
      depthMm,
      unit: input.unit ?? current.unit,
      timestamp: input.timestamp ?? current.timestamp,
      updatedAt: now,
    };
  },
  beforeDelete: (current, database) => {
    const linkedRecord = database.testRecords.find((record) => record.measurementIds.includes(current.id));

    if (linkedRecord) {
      throw new ConflictError('Cannot delete a measurement that is referenced by a test record.', {
        measurementId: current.id,
        testRecordId: linkedRecord.id,
      });
    }
  },
});
