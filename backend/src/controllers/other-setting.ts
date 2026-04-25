import { createCrudController } from './create-crud-controller';
import { otherSettingService } from '../lib/services/other-setting.service';

export const {
  create: createOtherSetting,
  getAll: getOtherSettings,
  getById: getOtherSettingById,
  update: updateOtherSetting,
  remove: deleteOtherSetting,
} = createCrudController(otherSettingService);
