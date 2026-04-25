import type { Response } from 'express';
import { asyncHandler } from '../lib/http';
import { resetToFactory } from '../lib/services/factory-reset.service';

export const restoreFactorySettings = asyncHandler(async (_req, res: Response) => {
  await resetToFactory();
  res.status(204).send();
});
