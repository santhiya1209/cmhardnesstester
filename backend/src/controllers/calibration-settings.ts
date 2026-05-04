import { createCrudController } from './create-crud-controller';
import {
  calibrationSettingsLookupService,
  calibrationSettingsService,
} from '../lib/services/calibration-settings.service';
import { asyncHandler } from '../lib/http';

export const {
  create: createCalibrationSettings,
  getAll: getCalibrationSettings,
  getById: getCalibrationSettingsById,
  update: updateCalibrationSettings,
  remove: deleteCalibrationSettings,
} = createCrudController(calibrationSettingsService);

export const getActiveCalibrationSettings = asyncHandler(async (_req, res) => {
  res.json(await calibrationSettingsLookupService.getActive());
});

export const getCalibrationSettingsByObjective = asyncHandler(async (req, res) => {
  res.json(await calibrationSettingsLookupService.getByObjective(String(req.params.objective)));
});

export const setActiveCalibrationSettings = asyncHandler(async (req, res) => {
  res.json(await calibrationSettingsLookupService.setActive(String(req.params.id)));
});
