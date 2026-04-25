import { Router } from 'express';
import { restoreFactorySettings } from '../controllers/factory-reset';

const router = Router();

router.post('/', restoreFactorySettings);

export default router;
