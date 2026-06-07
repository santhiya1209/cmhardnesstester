import { Router } from 'express';
import {
  connectStage,
  diagnoseStage,
  disconnectStage,
  getStagePosition,
  getStageState,
  locateStageCenter,
  lockXy,
  lockZ,
  moveStage,
  moveStageToCenter,
  moveZ,
  probeStage,
  setFocusMode,
  setXySpeed,
  setZSpeed,
  stopStage,
  stopZ,
  streamStageEvents,
  testLineControlStage,
  unlockXy,
  unlockZ,
} from '../controllers/xyz-platform';

// Dedicated XYZ motion-stage ACTION routes. NOTE: hardware control only — the
// xyz-platform-states router (CRUD) handles UI-state persistence separately.
const router = Router();

router.get('/state', getStageState);
router.get('/events', streamStageEvents);
router.post('/connect', connectStage);
router.post('/diagnose', diagnoseStage);
router.post('/test-line-control', testLineControlStage);
router.post('/probe', probeStage);
router.post('/disconnect', disconnectStage);
router.post('/move-stage', moveStage);
router.post('/stop-stage', stopStage);
router.post('/move-z', moveZ);
router.post('/stop-z', stopZ);
router.post('/lock-z', lockZ);
router.post('/unlock-z', unlockZ);
router.post('/lock-xy', lockXy);
router.post('/unlock-xy', unlockXy);
router.post('/set-focus-mode', setFocusMode);
router.post('/set-xy-speed', setXySpeed);
router.post('/set-z-speed', setZSpeed);
router.get('/position', getStagePosition);
router.post('/move-center', moveStageToCenter);
router.post('/locate-center', locateStageCenter);

export default router;
