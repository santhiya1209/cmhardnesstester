import {
  SerialPortSettingModel,
  type SerialPortSetting,
  type SerialPortSettingPayload,
} from '../../models/serial-port-setting';
import { createCrudService } from './create-crud.service';

export type CreateSerialPortSettingInput = SerialPortSettingPayload;
export type UpdateSerialPortSettingInput = Partial<SerialPortSettingPayload>;

export const serialPortSettingService = createCrudService<
  SerialPortSetting,
  CreateSerialPortSettingInput,
  UpdateSerialPortSettingInput
>({
  collection: 'serialPortSettings',
  resourceName: 'Serial port setting',
  schema: SerialPortSettingModel,
  createEntity: (input, { id, now }) => ({
    id,
    xyPortName: input.xyPortName ?? null,
    zPortName: input.zPortName ?? null,
    createdAt: now,
    updatedAt: now,
  }),
  updateEntity: (current, input, { now }) => ({
    ...current,
    ...input,
    updatedAt: now,
  }),
});
