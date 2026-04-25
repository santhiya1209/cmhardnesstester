import { createCrudController } from './create-crud-controller';
import { calibrationSettingsService } from '../lib/services/calibration-settings.service';

export const {
  create: createCalibrationSettings,
  getAll: getCalibrationSettings,
  getById: getCalibrationSettingsById,
  update: updateCalibrationSettings,
  remove: deleteCalibrationSettings,
} = createCrudController(calibrationSettingsService);
