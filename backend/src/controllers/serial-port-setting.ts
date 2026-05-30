import type { Request, Response } from 'express';
import { asyncHandler } from '../lib/http';
import { serialPortSettingService } from '../lib/services/serial-port-setting.service';
import type { CreateSerialPortSettingInput, UpdateSerialPortSettingInput } from '../lib/services/serial-port-setting.service';
import { createCrudController } from './create-crud-controller';

const base = createCrudController(serialPortSettingService);

export const getSerialPortSettings = base.getAll;
export const getSerialPortSettingById = base.getById;
export const deleteSerialPortSetting = base.remove;

export const createSerialPortSetting = asyncHandler(async (req: Request, res: Response) => {
  const body = (req as unknown as { validated: { body: CreateSerialPortSettingInput } }).validated.body;
  // eslint-disable-next-line no-console
  console.log(`[serial-port-db-save] machineComPort=${body.machineComPort ?? '(none)'}`);
  const created = await serialPortSettingService.create(body);
  res.status(201).json(created);
});

export const updateSerialPortSetting = asyncHandler(async (req: Request, res: Response) => {
  const { id } = (req as unknown as { validated: { params: { id: string } } }).validated.params;
  const body = (req as unknown as { validated: { body: UpdateSerialPortSettingInput } }).validated.body;
  // eslint-disable-next-line no-console
  console.log(`[serial-port-db-save] machineComPort=${body.machineComPort ?? '(none)'}`);
  const updated = await serialPortSettingService.update(id, body);
  res.json(updated);
});
