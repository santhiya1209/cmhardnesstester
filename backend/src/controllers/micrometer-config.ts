import { createCrudController } from './create-crud-controller';
import { micrometerConfigService } from '../lib/services/micrometer-config.service';

export const {
  create: createMicrometerConfig,
  getAll: getMicrometerConfig,
  getById: getMicrometerConfigById,
  update: updateMicrometerConfig,
  remove: deleteMicrometerConfig,
} = createCrudController(micrometerConfigService);
