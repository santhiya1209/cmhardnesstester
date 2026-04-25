import { Router } from 'express';
import {
  createSerialPortSetting,
  deleteSerialPortSetting,
  getSerialPortSettingById,
  getSerialPortSettings,
  updateSerialPortSetting,
} from '../controllers/serial-port-setting';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateSerialPortSettingSchema,
  UpdateSerialPortSettingSchema,
} from '../zod/serial-port-setting.schema';

const router = Router();

router.get('/', getSerialPortSettings);
router.post('/', validate(CreateSerialPortSettingSchema), createSerialPortSetting);
router.get('/:id', validate(IdParamsSchema, 'params'), getSerialPortSettingById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateSerialPortSettingSchema),
  updateSerialPortSetting
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteSerialPortSetting);

export default router;
