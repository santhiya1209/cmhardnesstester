import { Router } from 'express';
import {
  createXyzPlatformSettings,
  deleteXyzPlatformSettings,
  getXyzPlatformSettings,
  getXyzPlatformSettingsById,
  updateXyzPlatformSettings,
} from '../controllers/xyz-platform-settings';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateXYZPlatformSettingsSchema,
  UpdateXYZPlatformSettingsSchema,
} from '../zod/xyz-platform-settings.schema';

const router = Router();

router.get('/', getXyzPlatformSettings);
router.post('/', validate(CreateXYZPlatformSettingsSchema), createXyzPlatformSettings);
router.get('/:id', validate(IdParamsSchema, 'params'), getXyzPlatformSettingsById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateXYZPlatformSettingsSchema),
  updateXyzPlatformSettings
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteXyzPlatformSettings);

export default router;
