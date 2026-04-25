import { Router } from 'express';
import {
  createOtherSetting,
  deleteOtherSetting,
  getOtherSettingById,
  getOtherSettings,
  updateOtherSetting,
} from '../controllers/other-setting';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateOtherSettingSchema,
  UpdateOtherSettingSchema,
} from '../zod/other-setting.schema';

const router = Router();

router.get('/', getOtherSettings);
router.post('/', validate(CreateOtherSettingSchema), createOtherSetting);
router.get('/:id', validate(IdParamsSchema, 'params'), getOtherSettingById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateOtherSettingSchema),
  updateOtherSetting
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteOtherSetting);

export default router;
