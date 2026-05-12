import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import * as credentialService from '../services/kisCredentialService.js';
import * as kisAuthService from '../services/kisAuthService.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res, next) => {
  try {
    res.json(credentialService.getSettings(req.userId));
  } catch (error) {
    next(error);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.json(credentialService.saveSettings(req.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.delete('/', (req, res, next) => {
  try {
    credentialService.deleteSettings(req.userId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/test', async (req, res, next) => {
  try {
    res.json(await kisAuthService.testConnection(req.userId));
  } catch (error) {
    next(error);
  }
});

export default router;
