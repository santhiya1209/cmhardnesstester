import { Router } from 'express';
import {
  createCameraSetting,
  deleteCameraSetting,
  getCameraSettingById,
  getCameraSettings,
  updateCameraSetting,
} from '../controllers/camera-setting';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateCameraSettingSchema,
  UpdateCameraSettingSchema,
} from '../zod/camera-setting.schema';

const router = Router();

router.get('/', getCameraSettings);
router.post('/', validate(CreateCameraSettingSchema), createCameraSetting);
router.get('/:id', validate(IdParamsSchema, 'params'), getCameraSettingById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateCameraSettingSchema),
  updateCameraSetting
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteCameraSetting);

export default router;
