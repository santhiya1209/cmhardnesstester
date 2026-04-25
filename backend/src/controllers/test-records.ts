import { createCrudController } from './create-crud-controller';
import { testRecordsService } from '../lib/services/test-records.service';

export const {
  create: createTestRecord,
  getAll: getTestRecords,
  getById: getTestRecordById,
  update: updateTestRecord,
  remove: deleteTestRecord,
} = createCrudController(testRecordsService);
