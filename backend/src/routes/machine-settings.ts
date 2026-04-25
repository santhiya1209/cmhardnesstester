import { Router } from 'express';
import {
  createMachineSettings,
  deleteMachineSettings,
  getMachineSettings,
  getMachineSettingsById,
  updateMachineSettings,
} from '../controllers/machine-settings';
import { validate } from '../lib/validate';
import { IdParamsSchema } from '../zod/common.schema';
import {
  CreateMachineSettingsSchema,
  UpdateMachineSettingsSchema,
} from '../zod/machine-settings.schema';

const router = Router();

router.get('/', getMachineSettings);
router.post('/', validate(CreateMachineSettingsSchema), createMachineSettings);
router.get('/:id', validate(IdParamsSchema, 'params'), getMachineSettingsById);
router.put(
  '/:id',
  validate(IdParamsSchema, 'params'),
  validate(UpdateMachineSettingsSchema),
  updateMachineSettings
);
router.delete('/:id', validate(IdParamsSchema, 'params'), deleteMachineSettings);

export default router;
