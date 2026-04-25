import { Router } from 'express';
import {
  createAutoMeasureSettings,
  deleteAutoMeasureSettings,
  getAutoMeasureSettings,
  getAutoMeasureSettingsById,
  updateAutoMeasureSettings,
} from '../controllers/auto-measure-settings';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateAutoMeasureSettingsSchema,
  UpdateAutoMeasureSettingsSchema,
} from '../zod/auto-measure-settings.schema';

const router = Router();

router.get('/', getAutoMeasureSettings);
router.post('/', validate(CreateAutoMeasureSettingsSchema), createAutoMeasureSettings);
router.get('/:id', validate(IdParamsSchema, 'params'), getAutoMeasureSettingsById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateAutoMeasureSettingsSchema),
  updateAutoMeasureSettings
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteAutoMeasureSettings);

export default router;
