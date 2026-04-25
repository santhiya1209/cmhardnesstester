import { Router } from 'express';
import {
  createTestRecord,
  deleteTestRecord,
  getTestRecordById,
  getTestRecords,
  updateTestRecord,
} from '../controllers/test-records';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import { CreateTestRecordSchema, UpdateTestRecordSchema } from '../zod/test-records.schema';

const router = Router();

router.get('/', getTestRecords);
router.post('/', validate(CreateTestRecordSchema), createTestRecord);
router.get('/:id', validate(IdParamsSchema, 'params'), getTestRecordById);
router.put('/:id', validate(IdParamsSchema, 'params'), validate(UpdateTestRecordSchema), updateTestRecord);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteTestRecord);

export default router;
