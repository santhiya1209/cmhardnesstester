import type { Request, Response } from 'express';
import { createCrudController } from './create-crud-controller';
import { measurementsService } from '../lib/services/measurements.service';
import { deleteAllMeasurements } from '../lib/sqlite';

export const {
  create: createMeasurement,
  getAll: getMeasurements,
  getById: getMeasurementById,
  update: updateMeasurement,
  remove: deleteMeasurement,
} = createCrudController(measurementsService);

/**
 * DELETE /api/measurements (no :id)
 * Clears every measurement row for the current session.
 * Called by the Electron close handler and optionally on startup.
 */
export function clearAllMeasurements(_req: Request, res: Response): void {
  try {
    const deleted = deleteAllMeasurements();
    // eslint-disable-next-line no-console
    console.log(`[measurement-session-clear][success] deleted=${deleted}`);
    res.json({ ok: true, deleted });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[measurement-session-clear][skip] reason=${reason}`);
    res.status(500).json({ ok: false, reason });
  }
}
