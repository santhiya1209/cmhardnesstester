import { Router } from 'express';
import {
  connectMachine,
  disconnectMachine,
  getMachineState,
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

export default router;
