import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

export const ComPortSchema = z.enum([
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'COM10',
]);

export const SerialPortSettingPayloadSchema = z.object({
  mainPortName: ComPortSchema,
  xyPortName: ComPortSchema,
  zPortName: ComPortSchema,
});

export const SerialPortSettingModel = SerialPortSettingPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ComPort = z.infer<typeof ComPortSchema>;
export type SerialPortSettingPayload = z.infer<typeof SerialPortSettingPayloadSchema>;
export type SerialPortSetting = z.infer<typeof SerialPortSettingModel>;
