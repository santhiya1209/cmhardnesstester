import type { MachineSettingsPayload } from '../../models/machine-settings';
import { MachineSettingsModel, type MachineSettings } from '../../models/machine-settings';
import { createCrudService } from './create-crud.service';

export type CreateMachineSettingsInput = MachineSettingsPayload;
export type UpdateMachineSettingsInput = Partial<MachineSettingsPayload>;

export const machineSettingsService = createCrudService<
  MachineSettings,
  CreateMachineSettingsInput,
  UpdateMachineSettingsInput
>({
  collection: 'machineSettings',
  resourceName: 'Machine setting',
  schema: MachineSettingsModel,
  createEntity: (input, { id, now }) => ({
    id,
    ...input,
    createdAt: now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    updatedAt: now,
  }),
});
