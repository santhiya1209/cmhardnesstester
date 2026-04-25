import { Router } from 'express';
import {
  createDepthImageSetting,
  deleteDepthImageSetting,
  getDepthImageSettingById,
  getDepthImageSettings,
  updateDepthImageSetting,
} from '../controllers/depth-image-settings';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateDepthImageSettingSchema,
  UpdateDepthImageSettingSchema,
} from '../zod/depth-image-settings.schema';

const router = Router();

router.get('/', getDepthImageSettings);
router.post('/', validate(CreateDepthImageSettingSchema), createDepthImageSetting);
router.get('/:id', validate(IdParamsSchema, 'params'), getDepthImageSettingById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateDepthImageSettingSchema),
  updateDepthImageSetting
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteDepthImageSetting);

export default router;
