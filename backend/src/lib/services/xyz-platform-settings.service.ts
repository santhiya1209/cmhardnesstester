import type { XYZPlatformSettingsPayload } from '../../models/xyz-platform-settings';
import {
  XYZPlatformSettingsModel,
  type XYZPlatformSettings,
} from '../../models/xyz-platform-settings';
import { createCrudService } from './create-crud.service';

export type CreateXYZPlatformSettingsInput = XYZPlatformSettingsPayload;
export type UpdateXYZPlatformSettingsInput = Partial<XYZPlatformSettingsPayload>;

export const xyzPlatformSettingsService = createCrudService<
  XYZPlatformSettings,
  CreateXYZPlatformSettingsInput,
  UpdateXYZPlatformSettingsInput
>({
  collection: 'xyzPlatformSettings',
  resourceName: 'XYZ platform setting',
  schema: XYZPlatformSettingsModel,
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
