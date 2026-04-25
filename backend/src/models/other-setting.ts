import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

export const LanguageSchema = z.enum(['English', 'Tamil', 'Hindi', 'Chinese', 'Japanese']);
export const HardnessConvertTableSchema = z.enum(['Common Convert Table']);

const AccuracyInt = z.number().int().min(0).max(6);
const TrimStepInt = z.number().int().min(0).max(100);
const NonNegativeInt = z.number().int().min(0);

export const OtherSettingPayloadSchema = z.object({
  language: LanguageSchema,
  hardnessValueAccuracy: AccuracyInt,
  conversionValueAccuracy: AccuracyInt,
  hardnessConvertTable: HardnessConvertTableSchema,
  trimFast: TrimStepInt,
  trimSlow: TrimStepInt,
  historyImageCount: NonNegativeInt,
  historyImageSizeMb: NonNegativeInt,
});

export const OtherSettingModel = OtherSettingPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type Language = z.infer<typeof LanguageSchema>;
export type HardnessConvertTable = z.infer<typeof HardnessConvertTableSchema>;
export type OtherSettingPayload = z.infer<typeof OtherSettingPayloadSchema>;
export type OtherSetting = z.infer<typeof OtherSettingModel>;
