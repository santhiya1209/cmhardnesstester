import { Router } from 'express';
import {
  createLineColorSetting,
  deleteLineColorSetting,
  getLineColorSettingById,
  getLineColorSettings,
  updateLineColorSetting,
} from '../controllers/line-color-setting';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateLineColorSettingSchema,
  UpdateLineColorSettingSchema,
} from '../zod/line-color-setting.schema';

const router = Router();

router.get('/', getLineColorSettings);
router.post('/', validate(CreateLineColorSettingSchema), createLineColorSetting);
router.get('/:id', validate(IdParamsSchema, 'params'), getLineColorSettingById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateLineColorSettingSchema),
  updateLineColorSetting
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteLineColorSetting);

export default router;
