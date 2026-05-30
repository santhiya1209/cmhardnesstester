import type { Request, Response } from 'express';
import { asyncHandler } from '../lib/http';
import { micrometerConfigService } from '../lib/services/micrometer-config.service';
import type { MicrometerConfigPayload } from '../models/micrometer-config';
import { createCrudController } from './create-crud-controller';

const base = createCrudController(micrometerConfigService);

export const getMicrometerConfig = base.getAll;
export const getMicrometerConfigById = base.getById;
export const deleteMicrometerConfig = base.remove;

export const createMicrometerConfig = asyncHandler(async (req: Request, res: Response) => {
  const body = (req as unknown as { validated: { body: MicrometerConfigPayload } }).validated.body;
  // eslint-disable-next-line no-console
  console.log(`[micrometer-db-save] comPort=${body.comPort ?? '(none)'} enabled=${body.enabled}`);
  const created = await micrometerConfigService.create(body);
  res.status(201).json(created);
});

export const updateMicrometerConfig = asyncHandler(async (req: Request, res: Response) => {
  const { id } = (req as unknown as { validated: { params: { id: string } } }).validated.params;
  const body = (req as unknown as { validated: { body: Partial<MicrometerConfigPayload> } }).validated.body;
  // eslint-disable-next-line no-console
  console.log(`[micrometer-db-save] comPort=${body.comPort ?? '(none)'} enabled=${body.enabled}`);
  const updated = await micrometerConfigService.update(id, body);
  res.json(updated);
});
