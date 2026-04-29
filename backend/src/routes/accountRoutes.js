import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import { getAccountDeposit } from '../services/marketDataService.js';

const router = Router();
router.use(requireAuth);

router.get('/deposit', async (req, res, next) => {
  try {
    res.json(await getAccountDeposit(req.userId));
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  }
});

export default router;
