import { Router } from 'express';
import {
  createCalibrationSettings,
  deleteCalibrationSettings,
  getCalibrationSettings,
  getCalibrationSettingsById,
  updateCalibrationSettings,
} from '../controllers/calibration-settings';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateCalibrationSettingsSchema,
  UpdateCalibrationSettingsSchema,
} from '../zod/calibration-settings.schema';

const router = Router();

router.get('/', getCalibrationSettings);
router.post('/', validate(CreateCalibrationSettingsSchema), createCalibrationSettings);
router.get('/:id', validate(IdParamsSchema, 'params'), getCalibrationSettingsById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateCalibrationSettingsSchema),
  updateCalibrationSettings
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteCalibrationSettings);

export default router;
