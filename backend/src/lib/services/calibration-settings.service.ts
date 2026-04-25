import type { CalibrationSettingsPayload } from '../../models/calibration-settings';
import {
  CalibrationSettingsModel,
  type CalibrationSettings,
} from '../../models/calibration-settings';
import { createCrudService } from './create-crud.service';

export type CreateCalibrationSettingsInput = Omit<CalibrationSettingsPayload, 'calibrationDate'> & {
  calibrationDate?: string;
};

export type UpdateCalibrationSettingsInput = Partial<CreateCalibrationSettingsInput>;

export const calibrationSettingsService = createCrudService<
  CalibrationSettings,
  CreateCalibrationSettingsInput,
  UpdateCalibrationSettingsInput
>({
  collection: 'calibrationSettings',
  resourceName: 'Calibration setting',
  schema: CalibrationSettingsModel,
  createEntity: (input, { id, now }) => ({
    id,
    objective: input.objective,
    pixelToMicron: input.pixelToMicron,
    calibrationDate: input.calibrationDate ?? now,
    createdAt: now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    calibrationDate: input.calibrationDate ?? current.calibrationDate,
    updatedAt: now,
  }),
});
