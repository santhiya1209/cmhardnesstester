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

function computeAverageMm(averageUm: number | null): number | null {
  return averageUm === null ? null : Number((averageUm / 1000).toFixed(6));
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
    const d1Px = input.d1Px ?? (input.unit === 'px' ? input.d1 : null);
    const d2Px = input.d2Px ?? (input.unit === 'px' ? input.d2 : null);
    const d1Um = input.d1Um ?? (input.unit === 'um' ? input.d1 : null);
    const d2Um = input.d2Um ?? (input.unit === 'um' ? input.d2 : null);
    const averageUm = input.averageUm ?? (d1Um !== null && d2Um !== null ? computeAverage(d1Um, d2Um) : null);
    const averageMm = input.averageMm ?? computeAverageMm(averageUm);
    const average = averageUm ?? computeAverage(input.d1, input.d2);

    return {
      id,
      d1: input.d1,
      d2: input.d2,
      average,
      hv: input.hv ?? null,
      depthMm: input.depthMm ?? null,
      method: input.method ?? 'Manual',
      unit: input.unit ?? 'um',
      d1Px,
      d2Px,
      d1Um,
      d2Um,
      averageUm,
      averageMm,
      micronPerPixel: input.micronPerPixel ?? null,
      calibrationName: input.calibrationName ?? null,
      objective: input.objective ?? null,
      testForceKgf: input.testForceKgf ?? null,
      timestamp,
      imageDataUrl: input.imageDataUrl,
      xMm: input.xMm ?? null,
      yMm: input.yMm ?? null,
      qualified: input.qualified ?? null,
      createdAt: now,
      updatedAt: now,
    };
  },
  updateEntity: (current, input, { now }) => {
    const d1 = input.d1 ?? current.d1;
    const d2 = input.d2 ?? current.d2;
    const hv = input.hv === undefined ? current.hv : input.hv;
    const depthMm = input.depthMm === undefined ? current.depthMm ?? null : input.depthMm;
    const d1Px = input.d1Px === undefined ? current.d1Px ?? null : input.d1Px;
    const d2Px = input.d2Px === undefined ? current.d2Px ?? null : input.d2Px;
    const d1Um = input.d1Um === undefined ? current.d1Um ?? null : input.d1Um;
    const d2Um = input.d2Um === undefined ? current.d2Um ?? null : input.d2Um;
    const averageUm =
      input.averageUm === undefined
        ? d1Um !== null && d2Um !== null
          ? computeAverage(d1Um, d2Um)
          : current.averageUm ?? null
        : input.averageUm;
    const averageMm =
      input.averageMm === undefined
        ? computeAverageMm(averageUm)
        : input.averageMm;

    return {
      ...current,
      ...input,
      d1,
      d2,
      average: averageUm ?? computeAverage(d1, d2),
      hv,
      depthMm,
      d1Px,
      d2Px,
      d1Um,
      d2Um,
      averageUm,
      averageMm,
      micronPerPixel:
        input.micronPerPixel === undefined ? current.micronPerPixel ?? null : input.micronPerPixel,
      calibrationName:
        input.calibrationName === undefined ? current.calibrationName ?? null : input.calibrationName,
      objective: input.objective === undefined ? current.objective ?? null : input.objective,
      testForceKgf:
        input.testForceKgf === undefined ? current.testForceKgf ?? null : input.testForceKgf,
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
