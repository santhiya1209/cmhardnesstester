import { createCrudController } from './create-crud-controller';
import { xyzPlatformSettingsService } from '../lib/services/xyz-platform-settings.service';

export const {
  create: createXyzPlatformSettings,
  getAll: getXyzPlatformSettings,
  getById: getXyzPlatformSettingsById,
  update: updateXyzPlatformSettings,
  remove: deleteXyzPlatformSettings,
} = createCrudController(xyzPlatformSettingsService);
