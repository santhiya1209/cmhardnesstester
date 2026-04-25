import {
  LineColorSettingModel,
  type LineColorSetting,
  type LineColorSettingPayload,
} from '../../models/line-color-setting';
import { createCrudService } from './create-crud.service';

export type CreateLineColorSettingInput = LineColorSettingPayload;
export type UpdateLineColorSettingInput = Partial<LineColorSettingPayload>;

export const lineColorSettingService = createCrudService<
  LineColorSetting,
  CreateLineColorSettingInput,
  UpdateLineColorSettingInput
>({
  collection: 'lineColorSettings',
  resourceName: 'Line color setting',
  schema: LineColorSettingModel,
  createEntity: (input, { id, now }) => ({
    id,
    lineColor: input.lineColor,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    updatedAt: now,
  }),
});
