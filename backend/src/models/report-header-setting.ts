import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

const Trimmed = z
  .string()
  .max(120)
  .transform((v) => v.trim());

export const ReportHeaderSettingPayloadSchema = z.object({
  sampleName: Trimmed,
  sampleSerialNumber: Trimmed,
  inspectionCompany: Trimmed,
  tester: Trimmed,
  reviewer: Trimmed,
  hardnessMin: z.number().nullable(),
  hardnessMax: z.number().nullable(),
});

export const ReportHeaderSettingModel = ReportHeaderSettingPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ReportHeaderSettingPayload = z.infer<typeof ReportHeaderSettingPayloadSchema>;
export type ReportHeaderSetting = z.infer<typeof ReportHeaderSettingModel>;
