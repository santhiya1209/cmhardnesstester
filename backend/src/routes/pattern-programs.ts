import { Router } from 'express';
import {
  createPatternProgram,
  deletePatternProgram,
  getPatternProgramById,
  getPatternPrograms,
  updatePatternProgram,
} from '../controllers/pattern-programs';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreatePatternProgramSchema,
  UpdatePatternProgramSchema,
} from '../zod/pattern-programs.schema';

const router = Router();

router.get('/', getPatternPrograms);
router.post('/', validate(CreatePatternProgramSchema), createPatternProgram);
router.get('/:id', validate(IdParamsSchema, 'params'), getPatternProgramById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdatePatternProgramSchema),
  updatePatternProgram
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deletePatternProgram);

export default router;
