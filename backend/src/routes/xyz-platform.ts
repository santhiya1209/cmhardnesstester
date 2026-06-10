import { Router } from 'express';
import {
  connectStage,
  connectZAxis,
  diagnoseStage,
  diagnoseStopZAxis,
  diagnoseZAxis,
  disconnectStage,
  disconnectZAxis,
  getStagePosition,
  getStageState,
  homeStage,
  locateStageCenter,
  lockXy,
  lockZ,
  moveStage,
  moveStageToCenter,
  moveStep,
  moveZ,
  pollZStatus,
  probeStage,
  probeZAxis,
  setFocusMode,
  setStageCenter,
  setXySpeed,
  setZSpeed,
  startZJog,
  stopStage,
  stopZ,
  stopZJog,
  streamStageEvents,
  testLineControlStage,
  unlockXy,
  unlockZ,
} from '../controllers/xyz-platform';
import {
  getZSettings,
  previewZSettings,
  revertZSettings,
  saveZSettings,
} from '../controllers/z-settings';

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
router.post('/move-step', moveStep);
router.post('/stop-stage', stopStage);
router.post('/move-z', moveZ);
router.post('/stop-z', stopZ);
router.post('/connect-z', connectZAxis);
router.post('/disconnect-z', disconnectZAxis);
router.post('/start-z-jog', startZJog);
router.post('/stop-z-jog', stopZJog);
router.post('/poll-z-status', pollZStatus);
router.post('/probe-z', probeZAxis);
router.post('/diagnose-stop-z', diagnoseStopZAxis);
router.post('/diagnose-z', diagnoseZAxis);
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
router.post('/set-center', setStageCenter);
router.post('/home', homeStage);

// Z Axis settings — backend-owned config singleton (NOT hardware movement).
router.get('/z-settings', getZSettings);
router.post('/z-settings', saveZSettings);
router.post('/z-settings/preview', previewZSettings);
router.post('/z-settings/revert', revertZSettings);

export default router;
