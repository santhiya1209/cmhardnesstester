import { Router } from 'express';
import {
  clearAllMeasurements,
  createMeasurement,
  deleteMeasurement,
  getMeasurementById,
  getMeasurements,
  updateMeasurement,
} from '../controllers/measurements';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import { CreateMeasurementSchema, UpdateMeasurementSchema } from '../zod/measurements.schema';

const router = Router();

// Session-clear: DELETE /api/measurements (no :id) — must be before /:id route
router.delete('/', clearAllMeasurements);

router.get('/', getMeasurements);
router.post('/', validate(CreateMeasurementSchema), createMeasurement);
router.get('/:id', validate(IdParamsSchema, 'params'), getMeasurementById);
router.put('/:id', validate(IdParamsSchema, 'params'), validate(UpdateMeasurementSchema), updateMeasurement);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteMeasurement);

export default router;
