import { Router } from 'express';
import {
  createMicrometerConfig,
  deleteMicrometerConfig,
  getMicrometerConfig,
  getMicrometerConfigById,
  updateMicrometerConfig,
} from '../controllers/micrometer-config';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateMicrometerConfigSchema,
  UpdateMicrometerConfigSchema,
} from '../zod/micrometer-config.schema';

const router = Router();

router.get('/', getMicrometerConfig);
router.post('/', validate(CreateMicrometerConfigSchema), createMicrometerConfig);
router.get('/:id', validate(IdParamsSchema, 'params'), getMicrometerConfigById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateMicrometerConfigSchema),
  updateMicrometerConfig
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteMicrometerConfig);

export default router;
