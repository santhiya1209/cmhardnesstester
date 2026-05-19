import type { MicrometerConfigPayload } from '../../models/micrometer-config';
import {
  MicrometerConfigModel,
  type MicrometerConfig,
} from '../../models/micrometer-config';
import { createCrudService } from './create-crud.service';

export type CreateMicrometerConfigInput = MicrometerConfigPayload;
export type UpdateMicrometerConfigInput = Partial<MicrometerConfigPayload>;

export const micrometerConfigService = createCrudService<
  MicrometerConfig,
  CreateMicrometerConfigInput,
  UpdateMicrometerConfigInput
>({
  collection: 'micrometerConfig',
  resourceName: 'Micrometer config',
  schema: MicrometerConfigModel,
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
