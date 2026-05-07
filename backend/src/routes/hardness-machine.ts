import { Router } from 'express';
import {
  confirmObjectivePhysical,
  connectMachine,
  disconnectMachine,
  getMachineState,
  sendTurret,
  setMachineControlValue,
  startIndent,
  streamMachineEvents,
} from '../controllers/hardness-machine';

const router = Router();

router.get('/state', getMachineState);
router.get('/events', streamMachineEvents);
router.post('/connect', connectMachine);
router.post('/disconnect', disconnectMachine);
router.post('/set', setMachineControlValue);
router.post('/indent', startIndent);
router.post('/turret', sendTurret);
router.post('/objective/confirm-physical', confirmObjectivePhysical);

export default router;
