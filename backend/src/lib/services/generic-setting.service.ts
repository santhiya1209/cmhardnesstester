import {
  GenericSettingModel,
  type GenericSetting,
  type GenericSettingPayload,
} from '../../models/generic-setting';
import { createCrudService } from './create-crud.service';

export type CreateGenericSettingInput = GenericSettingPayload;
export type UpdateGenericSettingInput = Partial<GenericSettingPayload>;

export const genericSettingService = createCrudService<
  GenericSetting,
  CreateGenericSettingInput,
  UpdateGenericSettingInput
>({
  collection: 'genericSettings',
  resourceName: 'Generic setting',
  schema: GenericSettingModel,
  createEntity: (input, { id, now }) => ({
    id,
    caseDepthHardness: input.caseDepthHardness,
    hardnessTestMode: input.hardnessTestMode,
    createdAt: now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    updatedAt: now,
  }),
});
