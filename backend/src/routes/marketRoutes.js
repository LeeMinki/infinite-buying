import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import { getCurrentPrice, getDailyPrices, searchSymbols } from '../services/marketDataService.js';

const router = Router();
router.use(requireAuth);

router.get('/stocks/search', async (req, res, next) => {
  try {
    res.json({ items: await searchSymbols(req.userId, req.query.q) });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message });
  }
});

router.get('/us/:symbol/price', async (req, res, next) => {
  try {
    res.json(await getCurrentPrice(req.userId, req.params.symbol, { market: 'US' }));
  } catch (error) {
    res.status(error.status || 503).json({
      error: error.message,
      manualFallback: true
    });
  }
});

router.get('/us/:symbol/daily', async (req, res, next) => {
  try {
    res.json(await getDailyPrices(req.userId, req.params.symbol, {
      market: 'US',
      from: req.query.from,
      to: req.query.to,
      refresh: req.query.refresh === 'true'
    }));
  } catch (error) {
    res.status(error.status || 503).json({
      error: error.message,
      manualFallback: false
    });
  }
});

router.get('/:market/:symbol/price', async (req, res, next) => {
  try {
    res.json(await getCurrentPrice(req.userId, req.params.symbol, {
      market: req.params.market,
      exchange: req.query.exchange
    }));
  } catch (error) {
    res.status(error.status || 503).json({
      error: error.message,
      manualFallback: true
    });
  }
});

router.get('/:market/:symbol/daily', async (req, res, next) => {
  try {
    res.json(await getDailyPrices(req.userId, req.params.symbol, {
      market: req.params.market,
      exchange: req.query.exchange,
      from: req.query.from,
      to: req.query.to,
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
