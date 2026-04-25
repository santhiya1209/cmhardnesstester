import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, NonNegativeNumberSchema } from './common';

export const HardnessTestModeSchema = z.enum(['HV', 'HK']);

export const GenericSettingPayloadSchema = z.object({
  caseDepthHardness: NonNegativeNumberSchema,
  hardnessTestMode: HardnessTestModeSchema,
});

export const GenericSettingModel = GenericSettingPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type HardnessTestMode = z.infer<typeof HardnessTestModeSchema>;
export type GenericSettingPayload = z.infer<typeof GenericSettingPayloadSchema>;
export type GenericSetting = z.infer<typeof GenericSettingModel>;
