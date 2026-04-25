import type { AutoMeasureSettingsPayload } from '../../models/auto-measure-settings';
import {
  AutoMeasureSettingsModel,
  type AutoMeasureSettings,
} from '../../models/auto-measure-settings';
import { createCrudService } from './create-crud.service';

export type CreateAutoMeasureSettingsInput = AutoMeasureSettingsPayload;
export type UpdateAutoMeasureSettingsInput = Partial<AutoMeasureSettingsPayload>;

export const autoMeasureSettingsService = createCrudService<
  AutoMeasureSettings,
  CreateAutoMeasureSettingsInput,
  UpdateAutoMeasureSettingsInput
>({
  collection: 'autoMeasureSettings',
  resourceName: 'Auto measure setting',
  schema: AutoMeasureSettingsModel,
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
