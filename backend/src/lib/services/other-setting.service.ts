import {
  OtherSettingModel,
  type OtherSetting,
  type OtherSettingPayload,
} from '../../models/other-setting';
import { createCrudService } from './create-crud.service';

export type CreateOtherSettingInput = OtherSettingPayload;
export type UpdateOtherSettingInput = Partial<OtherSettingPayload>;

export const otherSettingService = createCrudService<
  OtherSetting,
  CreateOtherSettingInput,
  UpdateOtherSettingInput
>({
  collection: 'otherSettings',
  resourceName: 'Other setting',
  schema: OtherSettingModel,
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
