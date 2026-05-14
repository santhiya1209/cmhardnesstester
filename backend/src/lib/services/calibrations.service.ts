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

function sameKey(a: { zoomTime: string; force: string; hardnessLevel: string }, b: { zoomTime: string; force: string; hardnessLevel: string }): boolean {
  return a.zoomTime === b.zoomTime && a.force === b.force && a.hardnessLevel === b.hardnessLevel;
}

async function upsert(input: CreateCalibrationInput): Promise<Calibration> {
  return mutateDatabase((database) => {
    const now = new Date().toISOString();
    const items = database.calibrations;
    const key = { zoomTime: input.zoomTime, force: input.force, hardnessLevel: input.hardnessLevel };

    const matchingIndexes = items
      .map((item, index) => (sameKey(item, key) ? index : -1))
      .filter((index) => index !== -1);

    if (matchingIndexes.length === 0) {
      const entity = CalibrationModel.parse({
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
      });
      console.log(
        `[calibration-upsert-check] objective=${input.zoomTime} force=${input.force} hardnessLevel=${input.hardnessLevel} existingId=null`
      );
      console.log(`[calibration-upsert-insert] id=${entity.id}`);
      return {
        database: { ...database, calibrations: [...items, entity] },
        result: entity,
      };
    }

    // Keep the most recently updated existing row; collapse the rest.
    const sortedByUpdate = [...matchingIndexes].sort((a, b) => {
      const ua = items[a].updatedAt ?? '';
      const ub = items[b].updatedAt ?? '';
      return ub.localeCompare(ua);
    });
    const keepIndex = sortedByUpdate[0];
    const current = items[keepIndex];
    const removedIds = sortedByUpdate.slice(1).map((index) => items[index].id);

    const merged = CalibrationModel.parse({
      ...current,
      ...input,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now,
    });

    console.log(
      `[calibration-upsert-check] objective=${input.zoomTime} force=${input.force} hardnessLevel=${input.hardnessLevel} existingId=${current.id}`
    );
    console.log(`[calibration-upsert-update] id=${merged.id}`);
    if (removedIds.length > 0) {
      console.log(
        `[calibration-duplicates-cleanup] objective=${input.zoomTime} force=${input.force} hardnessLevel=${input.hardnessLevel} keptId=${merged.id} removed=${removedIds.join(',')}`
      );
    }

    const removedSet = new Set(removedIds);
    const next = items
      .map((item, index) => (index === keepIndex ? merged : item))
      .filter((item) => !removedSet.has(item.id));

    return {
      database: { ...database, calibrations: next },
      result: merged,
    };
  });
}

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
  // POST /api/calibrations performs upsert by (zoomTime, force, hardnessLevel)
  // so re-saving the same combination updates the existing row instead of
  // creating duplicates.
  create: upsert,
  upsert,
  clearAll,
  bulkCreate,
};
