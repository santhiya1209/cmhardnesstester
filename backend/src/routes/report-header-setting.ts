import { Router } from 'express';
import {
  createReportHeaderSetting,
  deleteReportHeaderSetting,
  getReportHeaderSettingById,
  getReportHeaderSettings,
  updateReportHeaderSetting,
} from '../controllers/report-header-setting';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateReportHeaderSettingSchema,
  UpdateReportHeaderSettingSchema,
} from '../zod/report-header-setting.schema';

const router = Router();

router.get('/', getReportHeaderSettings);
router.post('/', validate(CreateReportHeaderSettingSchema), createReportHeaderSetting);
router.get('/:id', validate(IdParamsSchema, 'params'), getReportHeaderSettingById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateReportHeaderSettingSchema),
  updateReportHeaderSetting
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteReportHeaderSetting);

export default router;
