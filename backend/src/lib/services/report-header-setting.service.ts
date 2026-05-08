import {
  ReportHeaderSettingModel,
  type ReportHeaderSetting,
  type ReportHeaderSettingPayload,
} from '../../models/report-header-setting';
import { createCrudService } from './create-crud.service';

export type CreateReportHeaderSettingInput = ReportHeaderSettingPayload;
export type UpdateReportHeaderSettingInput = Partial<ReportHeaderSettingPayload>;

export const reportHeaderSettingService = createCrudService<
  ReportHeaderSetting,
  CreateReportHeaderSettingInput,
  UpdateReportHeaderSettingInput
>({
  collection: 'reportHeaderSettings',
  resourceName: 'Report header setting',
  schema: ReportHeaderSettingModel,
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
