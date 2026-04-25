import { buildUpdateSchema } from './common.schema';
import { SerialPortSettingPayloadSchema } from '../models/serial-port-setting';

export const CreateSerialPortSettingSchema = SerialPortSettingPayloadSchema;
export const UpdateSerialPortSettingSchema = buildUpdateSchema(CreateSerialPortSettingSchema);

export type CreateSerialPortSettingInput = typeof CreateSerialPortSettingSchema._output;
export type UpdateSerialPortSettingInput = typeof UpdateSerialPortSettingSchema._output;
