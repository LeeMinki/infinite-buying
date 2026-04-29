import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import { getCurrentPrice, getDailyPrices } from '../services/marketDataService.js';

const router = Router();
router.use(requireAuth);

router.get('/:stockCode/price', async (req, res, next) => {
  try {
    res.json(await getCurrentPrice(req.userId, req.params.stockCode));
  } catch (error) {
    res.status(503).json({
      error: error.message,
      manualFallback: true
    });
  }
});

router.get('/:stockCode/daily', async (req, res, next) => {
  try {
    res.json(await getDailyPrices(req.userId, req.params.stockCode, {
      from: req.query.from,
      to: req.query.to
    }));
  } catch (error) {
    res.status(503).json({
      error: error.message,
      manualFallback: false
    });
  }
});

export default router;
