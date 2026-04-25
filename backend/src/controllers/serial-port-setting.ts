import { createCrudController } from './create-crud-controller';
import { serialPortSettingService } from '../lib/services/serial-port-setting.service';

export const {
  create: createSerialPortSetting,
  getAll: getSerialPortSettings,
  getById: getSerialPortSettingById,
  update: updateSerialPortSetting,
  remove: deleteSerialPortSetting,
} = createCrudController(serialPortSettingService);
