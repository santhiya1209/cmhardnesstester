import { buildUpdateSchema } from './common.schema';
import { MachineSettingsPayloadSchema } from '../models/machine-settings';

export const CreateMachineSettingsSchema = MachineSettingsPayloadSchema;
export const UpdateMachineSettingsSchema = buildUpdateSchema(MachineSettingsPayloadSchema);

export type CreateMachineSettingsInput = typeof CreateMachineSettingsSchema._output;
export type UpdateMachineSettingsInput = typeof UpdateMachineSettingsSchema._output;
