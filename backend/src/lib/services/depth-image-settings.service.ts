import type { DepthImageSettingPayload } from '../../models/depth-image-setting';
import {
  DepthImageSettingModel,
  type DepthImageSetting,
} from '../../models/depth-image-setting';
import { createCrudService } from './create-crud.service';

export type CreateDepthImageSettingInput = DepthImageSettingPayload;
export type UpdateDepthImageSettingInput = Partial<DepthImageSettingPayload>;

export const depthImageSettingsService = createCrudService<
  DepthImageSetting,
  CreateDepthImageSettingInput,
  UpdateDepthImageSettingInput
>({
  collection: 'depthImageSettings',
  resourceName: 'Depth image setting',
  schema: DepthImageSettingModel,
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
