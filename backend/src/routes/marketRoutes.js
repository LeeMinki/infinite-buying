import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import { getCurrentPrice, getDailyPrices, searchStocks } from '../services/marketDataService.js';

const router = Router();
router.use(requireAuth);

router.get('/stocks/search', async (req, res, next) => {
  try {
    res.json({ items: await searchStocks(req.userId, req.query.q) });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  }
});

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
      to: req.query.to,
      requireReal: req.query.requireReal === 'true',
      refresh: req.query.refresh === 'true'
    }));
  } catch (error) {
    res.status(error.status || 503).json({
      error: error.message,
      manualFallback: false
    });
  }
});

export default router;
