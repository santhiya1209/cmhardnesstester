import { createCrudController } from './create-crud-controller';
import { cameraSettingService } from '../lib/services/camera-setting.service';

export const {
  create: createCameraSetting,
  getAll: getCameraSettings,
  getById: getCameraSettingById,
  update: updateCameraSetting,
  remove: deleteCameraSetting,
} = createCrudController(cameraSettingService);
