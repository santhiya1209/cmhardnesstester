import type { Request, Response } from 'express';
import { asyncHandler } from '../lib/http';
import { cameraSettingService } from '../lib/services/camera-setting.service';
import type { CreateCameraSettingInput, UpdateCameraSettingInput } from '../lib/services/camera-setting.service';
import { createCrudController } from './create-crud-controller';

const base = createCrudController(cameraSettingService);

export const getCameraSettings = base.getAll;
export const getCameraSettingById = base.getById;
export const deleteCameraSetting = base.remove;

export const createCameraSetting = asyncHandler(async (req: Request, res: Response) => {
  const body = (req as unknown as { validated: { body: CreateCameraSettingInput } }).validated.body;
  // eslint-disable-next-line no-console
  console.log(`[camera-settings-db-save] gain=${body.analogGain} exposure=${body.exposureTimeMs}`);
  const created = await cameraSettingService.create(body);
  res.status(201).json(created);
});

export const updateCameraSetting = asyncHandler(async (req: Request, res: Response) => {
  const { id } = (req as unknown as { validated: { params: { id: string } } }).validated.params;
  const body = (req as unknown as { validated: { body: UpdateCameraSettingInput } }).validated.body;
  // eslint-disable-next-line no-console
  console.log(`[camera-settings-db-save] gain=${body.analogGain ?? '(unchanged)'} exposure=${body.exposureTimeMs ?? '(unchanged)'}`);
  const updated = await cameraSettingService.update(id, body);
  res.json(updated);
});
