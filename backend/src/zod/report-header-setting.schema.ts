import { buildUpdateSchema } from './common.schema';
import { ReportHeaderSettingPayloadSchema } from '../models/report-header-setting';

export const CreateReportHeaderSettingSchema = ReportHeaderSettingPayloadSchema;
export const UpdateReportHeaderSettingSchema = buildUpdateSchema(CreateReportHeaderSettingSchema);

export type CreateReportHeaderSettingInput = typeof CreateReportHeaderSettingSchema._output;
export type UpdateReportHeaderSettingInput = typeof UpdateReportHeaderSettingSchema._output;
