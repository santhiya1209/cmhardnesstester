import type { Request, Response } from 'express';
import { asyncHandler } from '../lib/http';
import { createCrudController } from './create-crud-controller';
import { calibrationsService } from '../lib/services/calibrations.service';
import type { ValidatedRequest } from '../lib/validate';
import type { ImportCalibrationsInput, CreateCalibrationInput } from '../zod/calibrations.schema';

const crud = createCrudController(calibrationsService);

export const getCalibrations = crud.getAll;
export const getCalibrationById = crud.getById;
export const updateCalibration = crud.update;
export const deleteCalibration = crud.remove;

export const createCalibration = asyncHandler(async (req: Request, res: Response) => {
  const body = (req as unknown as { validated: { body: CreateCalibrationInput } }).validated.body;
  // eslint-disable-next-line no-console
  console.log(
    `[calibration-db-save] objective=${body.zoomTime} force=${body.force} hardnessLevel=${body.hardnessLevel} pixelLengthX=${body.pixelLengthX} realDistX=${body.realDistanceX ?? 0}`
  );
  const created = await calibrationsService.create(body);
  res.status(201).json(created);
});

export const clearCalibrations = asyncHandler(async (_req, res: Response) => {
  await calibrationsService.clearAll();
  res.status(204).send();
});

export const importCalibrations = asyncHandler(async (req, res: Response) => {
  const validatedReq = req as ValidatedRequest<ImportCalibrationsInput>;
  const { items, replace } = validatedReq.validated.body as ImportCalibrationsInput;
  const created = await calibrationsService.bulkCreate(items, { replace });
  res.status(201).json(created);
});

export const exportCalibrations = asyncHandler(async (_req, res: Response) => {
  const items = await calibrationsService.getAll();
  res.json({
    exportedAt: new Date().toISOString(),
    count: items.length,
    items,
  });
});
