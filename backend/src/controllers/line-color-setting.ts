import { createCrudController } from './create-crud-controller';
import { lineColorSettingService } from '../lib/services/line-color-setting.service';

export const {
  create: createLineColorSetting,
  getAll: getLineColorSettings,
  getById: getLineColorSettingById,
  update: updateLineColorSetting,
  remove: deleteLineColorSetting,
} = createCrudController(lineColorSettingService);
