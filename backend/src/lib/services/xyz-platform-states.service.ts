import type { XYZPlatformStatePayload } from '../../models/xyz-platform-state';
import { XYZPlatformStateModel, type XYZPlatformState } from '../../models/xyz-platform-state';
import { createCrudService } from './create-crud.service';

export type CreateXYZPlatformStateInput = XYZPlatformStatePayload;
export type UpdateXYZPlatformStateInput = Partial<XYZPlatformStatePayload>;

export const xyzPlatformStatesService = createCrudService<
  XYZPlatformState,
  CreateXYZPlatformStateInput,
  UpdateXYZPlatformStateInput
>({
  collection: 'xyzPlatformStates',
  resourceName: 'XYZ platform state',
  schema: XYZPlatformStateModel,
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
