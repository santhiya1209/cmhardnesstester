import { Router } from 'express';
import {
  createToolbarState,
  deleteToolbarState,
  getToolbarStateById,
  getToolbarStates,
  updateToolbarState,
} from '../controllers/toolbar-states';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateToolbarStateSchema,
  UpdateToolbarStateSchema,
} from '../zod/toolbar-states.schema';

const router = Router();

router.get('/', getToolbarStates);
router.post('/', validate(CreateToolbarStateSchema), createToolbarState);
router.get('/:id', validate(IdParamsSchema, 'params'), getToolbarStateById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateToolbarStateSchema),
  updateToolbarState
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteToolbarState);

export default router;
