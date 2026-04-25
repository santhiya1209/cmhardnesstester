import { createCrudController } from './create-crud-controller';
import { depthImageSettingsService } from '../lib/services/depth-image-settings.service';

export const {
  create: createDepthImageSetting,
  getAll: getDepthImageSettings,
  getById: getDepthImageSettingById,
  update: updateDepthImageSetting,
  remove: deleteDepthImageSetting,
} = createCrudController(depthImageSettingsService);
