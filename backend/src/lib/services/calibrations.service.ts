import { randomUUID } from 'node:crypto';
import { mutateDatabase } from '../db';
import { CalibrationModel, type Calibration } from '../../models/calibration';
import type {
  CreateCalibrationInput,
  UpdateCalibrationInput,
} from '../../zod/calibrations.schema';
import { createCrudService } from './create-crud.service';

const baseService = createCrudService<Calibration, CreateCalibrationInput, UpdateCalibrationInput>({
  collection: 'calibrations',
  resourceName: 'Calibration',
  schema: CalibrationModel,
  createEntity: (input, { id, now }) => ({
    id,
    zoomTime: input.zoomTime,
    force: input.force,
    hardnessLevel: input.hardnessLevel,
    pixelLengthX: input.pixelLengthX,
    pixelLengthY: input.pixelLengthY,
    hardness: input.hardness,
    calibrationType: input.calibrationType,
    lengthMode: input.lengthMode,
    realDistanceX: input.realDistanceX,
    realDistanceY: input.realDistanceY,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    createdAt: input.createdAt ?? current.createdAt,
    updatedAt: now,
  }),
});

async function clearAll(): Promise<void> {
  await mutateDatabase((database) => ({
    database: { ...database, calibrations: [] },
    result: undefined,
  }));
}

async function bulkCreate(
  inputs: CreateCalibrationInput[],
  options: { replace?: boolean } = {}
): Promise<Calibration[]> {
  return mutateDatabase((database) => {
    const now = new Date().toISOString();
    const created: Calibration[] = inputs.map((input) =>
      CalibrationModel.parse({
        id: randomUUID(),
        zoomTime: input.zoomTime,
        force: input.force,
        hardnessLevel: input.hardnessLevel,
        pixelLengthX: input.pixelLengthX,
        pixelLengthY: input.pixelLengthY,
        hardness: input.hardness,
        calibrationType: input.calibrationType,
        lengthMode: input.lengthMode,
        realDistanceX: input.realDistanceX,
        realDistanceY: input.realDistanceY,
        createdAt: input.createdAt ?? now,
        updatedAt: now,
      })
    );

    const next = options.replace
      ? created
      : [...database.calibrations, ...created];

    return {
      database: { ...database, calibrations: next },
      result: created,
    };
  });
}

export const calibrationsService = {
  ...baseService,
  clearAll,
  bulkCreate,
};
