import { Router } from 'express';
import autoMeasureSettingsRouter from './auto-measure-settings';
import calibrationSettingsRouter from './calibration-settings';
import healthRouter from './health';
import machineSettingsRouter from './machine-settings';
import measurementsRouter from './measurements';
import testRecordsRouter from './test-records';

const router = Router();

router.use('/health', healthRouter);
router.use('/machine-settings', machineSettingsRouter);
router.use('/measurements', measurementsRouter);
router.use('/auto-measure-settings', autoMeasureSettingsRouter);
router.use('/calibration-settings', calibrationSettingsRouter);
router.use('/test-records', testRecordsRouter);

export default router;
