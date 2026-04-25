import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

export const LineColorSchema = z.enum([
  'Purple',
  'Yellow',
  'Red',
  'Green',
  'Blue',
  'White',
  'Black',
]);

export const LineColorSettingPayloadSchema = z.object({
  lineColor: LineColorSchema,
});

export const LineColorSettingModel = LineColorSettingPayloadSchema.extend({
  id: EntityIdSchema,
  updatedAt: IsoDateTimeSchema,
});

export type LineColor = z.infer<typeof LineColorSchema>;
export type LineColorSettingPayload = z.infer<typeof LineColorSettingPayloadSchema>;
export type LineColorSetting = z.infer<typeof LineColorSettingModel>;
