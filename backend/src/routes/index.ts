import { Router } from 'express';
import albumItemsRouter from './album-items';
import autoMeasureSettingsRouter from './auto-measure-settings';
import calibrationSettingsRouter from './calibration-settings';
import depthImageSettingsRouter from './depth-image-settings';
import healthRouter from './health';
import machineSettingsRouter from './machine-settings';
import measurementsRouter from './measurements';
import patternProgramsRouter from './pattern-programs';
import testRecordsRouter from './test-records';
import toolbarStatesRouter from './toolbar-states';
import xyzPlatformStatesRouter from './xyz-platform-states';

const router = Router();

router.use('/health', healthRouter);
router.use('/machine-settings', machineSettingsRouter);
router.use('/measurements', measurementsRouter);
router.use('/auto-measure-settings', autoMeasureSettingsRouter);
router.use('/calibration-settings', calibrationSettingsRouter);
router.use('/test-records', testRecordsRouter);
router.use('/xyz-platform-states', xyzPlatformStatesRouter);
router.use('/pattern-programs', patternProgramsRouter);
router.use('/depth-image-settings', depthImageSettingsRouter);
router.use('/album-items', albumItemsRouter);
router.use('/toolbar-states', toolbarStatesRouter);

export default router;
