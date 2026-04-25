import { createCrudController } from './create-crud-controller';
import { machineSettingsService } from '../lib/services/machine-settings.service';

export const {
  create: createMachineSettings,
  getAll: getMachineSettings,
  getById: getMachineSettingsById,
  update: updateMachineSettings,
  remove: deleteMachineSettings,
} = createCrudController(machineSettingsService);
