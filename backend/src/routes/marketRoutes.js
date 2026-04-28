import { Router } from 'express';
import { getCurrentPrice, getDailyPrices } from '../services/marketDataService.js';

const router = Router();

router.get('/:stockCode/price', async (req, res, next) => {
  try {
    res.json(await getCurrentPrice(req.params.stockCode));
  } catch (error) {
    res.status(503).json({
      error: error.message,
      manualFallback: true
    });
  }
});

router.get('/:stockCode/daily', async (req, res, next) => {
  try {
    res.json(await getDailyPrices(req.params.stockCode));
  } catch (error) {
    res.status(503).json({
      error: error.message,
      manualFallback: false
    });
  }
});

export default router;
