import { createCrudController } from './create-crud-controller';
import { genericSettingService } from '../lib/services/generic-setting.service';

export const {
  create: createGenericSetting,
  getAll: getGenericSettings,
  getById: getGenericSettingById,
  update: updateGenericSetting,
  remove: deleteGenericSetting,
} = createCrudController(genericSettingService);
