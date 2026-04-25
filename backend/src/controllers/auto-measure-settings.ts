import { createCrudController } from './create-crud-controller';
import { autoMeasureSettingsService } from '../lib/services/auto-measure-settings.service';

export const {
  create: createAutoMeasureSettings,
  getAll: getAutoMeasureSettings,
  getById: getAutoMeasureSettingsById,
  update: updateAutoMeasureSettings,
  remove: deleteAutoMeasureSettings,
} = createCrudController(autoMeasureSettingsService);
