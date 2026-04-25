import { Router } from 'express';
import {
  createGenericSetting,
  deleteGenericSetting,
  getGenericSettingById,
  getGenericSettings,
  updateGenericSetting,
} from '../controllers/generic-setting';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateGenericSettingSchema,
  UpdateGenericSettingSchema,
} from '../zod/generic-setting.schema';

const router = Router();

router.get('/', getGenericSettings);
router.post('/', validate(CreateGenericSettingSchema), createGenericSetting);
router.get('/:id', validate(IdParamsSchema, 'params'), getGenericSettingById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateGenericSettingSchema),
  updateGenericSetting
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteGenericSetting);

export default router;
