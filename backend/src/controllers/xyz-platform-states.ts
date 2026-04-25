import { createCrudController } from './create-crud-controller';
import { xyzPlatformStatesService } from '../lib/services/xyz-platform-states.service';

export const {
  create: createXYZPlatformState,
  getAll: getXYZPlatformStates,
  getById: getXYZPlatformStateById,
  update: updateXYZPlatformState,
  remove: deleteXYZPlatformState,
} = createCrudController(xyzPlatformStatesService);
