import { Router } from 'express';
import {
  createMultipointResult,
  deleteMultipointResult,
  getMultipointResultById,
  getMultipointResults,
  updateMultipointResult,
} from '../controllers/multipoint-results';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateMultipointResultSchema,
  UpdateMultipointResultSchema,
} from '../zod/multipoint-results.schema';

const router = Router();

router.get('/', getMultipointResults);
router.post('/', validate(CreateMultipointResultSchema), createMultipointResult);
router.get('/:id', validate(IdParamsSchema, 'params'), getMultipointResultById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateMultipointResultSchema),
  updateMultipointResult
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteMultipointResult);

export default router;
