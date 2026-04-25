import { Router } from 'express';
import {
  clearCalibrations,
  createCalibration,
  deleteCalibration,
  exportCalibrations,
  getCalibrationById,
  getCalibrations,
  importCalibrations,
  updateCalibration,
} from '../controllers/calibrations';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateCalibrationSchema,
  ImportCalibrationsSchema,
  UpdateCalibrationSchema,
} from '../zod/calibrations.schema';

const router = Router();

router.get('/export', exportCalibrations);
router.post('/import', validate(ImportCalibrationsSchema), importCalibrations);
router.delete('/clear', clearCalibrations);

router.get('/', getCalibrations);
router.post('/', validate(CreateCalibrationSchema), createCalibration);
router.get('/:id', validate(IdParamsSchema, 'params'), getCalibrationById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateCalibrationSchema),
  updateCalibration
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteCalibration);

export default router;
