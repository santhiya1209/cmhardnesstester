import { Router } from 'express';
import {
  createXYZPlatformState,
  deleteXYZPlatformState,
  getXYZPlatformStateById,
  getXYZPlatformStates,
  updateXYZPlatformState,
} from '../controllers/xyz-platform-states';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateXYZPlatformStateSchema,
  UpdateXYZPlatformStateSchema,
} from '../zod/xyz-platform-states.schema';

const router = Router();

router.get('/', getXYZPlatformStates);
router.post('/', validate(CreateXYZPlatformStateSchema), createXYZPlatformState);
router.get('/:id', validate(IdParamsSchema, 'params'), getXYZPlatformStateById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateXYZPlatformStateSchema),
  updateXYZPlatformState
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteXYZPlatformState);

export default router;
