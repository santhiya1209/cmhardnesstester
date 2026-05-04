import type { CalibrationSettingsPayload } from '../../models/calibration-settings';
import {
  CalibrationSettingsModel,
  type CalibrationSettings,
} from '../../models/calibration-settings';
import { mutateDatabase, readCollection } from '../db';
import { NotFoundError } from '../errors';
import { createCrudService } from './create-crud.service';

export type CreateCalibrationSettingsInput = Omit<CalibrationSettingsPayload, 'calibrationDate'> & {
  calibrationDate?: string;
};

export type UpdateCalibrationSettingsInput = Partial<CreateCalibrationSettingsInput>;

const VALID_OBJECTIVES = new Set(['2.5X', '5X', '10X', '20X', '40X', '50X']);

function normalizeObjectiveName(value: string): string {
  const compact = value
    .trim()
    .toUpperCase()
    .replace(/^OBJECTIVE\s*/, '')
    .replace(/\s+/g, '');
  const match = compact.match(/^(2\.5|5|10|20|40|50)X$/);
  return match ? `${match[1]}X` : compact;
}

function resolveUmPerPixel(
  input: Partial<CreateCalibrationSettingsInput>,
  current?: CalibrationSettings
): number {
  return input.umPerPixel ?? input.pixelToMicron ?? current?.umPerPixel ?? current?.pixelToMicron ?? 0;
}

function toStoredCalibration(
  input: CreateCalibrationSettingsInput | UpdateCalibrationSettingsInput,
  now: string,
  current?: CalibrationSettings,
  id = current?.id ?? ''
): CalibrationSettings {
  const objective = input.objective ?? current?.objective ?? '';
  const normalizedObjective = normalizeObjectiveName(objective);
  const umPerPixel = resolveUmPerPixel(input, current);
  const pixelPerMm = input.pixelPerMm ?? (umPerPixel > 0 ? 1000 / umPerPixel : current?.pixelPerMm);

  return CalibrationSettingsModel.parse({
    ...current,
    ...input,
    id,
    objective: normalizedObjective,
    normalizedObjective,
    pixelToMicron: umPerPixel,
    umPerPixel,
    pixelPerMm,
    active: input.active ?? current?.active ?? false,
    calibrationDate: input.calibrationDate ?? current?.calibrationDate ?? now,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  });
}

export const calibrationSettingsService = createCrudService<
  CalibrationSettings,
  CreateCalibrationSettingsInput,
  UpdateCalibrationSettingsInput
>({
  collection: 'calibrationSettings',
  resourceName: 'Calibration setting',
  schema: CalibrationSettingsModel,
  createEntity: (input, { id, now }) =>
    toStoredCalibration({ ...input, active: input.active ?? true }, now, undefined, id),
  updateEntity: (current, input, { now }) => toStoredCalibration(input, now, current),
});

async function getByObjective(objective: string): Promise<CalibrationSettings | null> {
  const normalizedObjective = normalizeObjectiveName(objective);
  if (!VALID_OBJECTIVES.has(normalizedObjective)) {
    return null;
  }

  const items = await readCollection('calibrationSettings');
  return [...items]
    .filter(
      (item) =>
        (normalizeObjectiveName(item.normalizedObjective ?? '') === normalizedObjective ||
          normalizeObjectiveName(item.objective) === normalizedObjective) &&
        (item.umPerPixel ?? item.pixelToMicron) > 0
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
}

async function getActive(): Promise<CalibrationSettings | null> {
  const items = await readCollection('calibrationSettings');
  return [...items]
    .filter((item) => item.active && (item.umPerPixel ?? item.pixelToMicron) > 0)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
}

async function setActive(id: string): Promise<CalibrationSettings> {
  return mutateDatabase((database) => {
    const index = database.calibrationSettings.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new NotFoundError('Calibration setting', id);
    }

    const now = new Date().toISOString();
    const nextItems = database.calibrationSettings.map((item, itemIndex) =>
      CalibrationSettingsModel.parse({
        ...item,
        active: itemIndex === index,
        updatedAt: itemIndex === index ? now : item.updatedAt,
      })
    );

    return {
      database: { ...database, calibrationSettings: nextItems },
      result: nextItems[index],
    };
  });
}

export const calibrationSettingsLookupService = {
  getActive,
  getByObjective,
  setActive,
};
