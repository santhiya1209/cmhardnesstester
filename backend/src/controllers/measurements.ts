import { createCrudController } from './create-crud-controller';
import { measurementsService } from '../lib/services/measurements.service';

export const {
  create: createMeasurement,
  getAll: getMeasurements,
  getById: getMeasurementById,
  update: updateMeasurement,
  remove: deleteMeasurement,
} = createCrudController(measurementsService);
