import { Router } from 'express';
import {
  connectStage,
  disconnectStage,
  getStagePosition,
  getStageState,
  locateStageCenter,
  lockZ,
  moveStage,
  moveStageToCenter,
  moveZ,
  setXySpeed,
  setZSpeed,
  stopStage,
  stopZ,
  streamStageEvents,
  unlockZ,
} from '../controllers/xyz-platform';

// Dedicated XYZ motion-stage ACTION routes. NOTE: hardware control only — the
// xyz-platform-states router (CRUD) handles UI-state persistence separately.
const router = Router();

router.get('/state', getStageState);
router.get('/events', streamStageEvents);
router.post('/connect', connectStage);
router.post('/disconnect', disconnectStage);
router.post('/move-stage', moveStage);
router.post('/stop-stage', stopStage);
router.post('/move-z', moveZ);
router.post('/stop-z', stopZ);
router.post('/lock-z', lockZ);
router.post('/unlock-z', unlockZ);
router.post('/set-xy-speed', setXySpeed);
router.post('/set-z-speed', setZSpeed);
router.get('/position', getStagePosition);
router.post('/move-center', moveStageToCenter);
router.post('/locate-center', locateStageCenter);

export default router;
