import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import * as service from '../services/autoTradingService.js';

const router = Router();
router.use(requireAuth);

router.get('/settings', (req, res, next) => {
  try {
    res.json(service.getSettings(req.userId));
  } catch (error) {
    next(error);
  }
});

router.put('/settings/live-order', (req, res, next) => {
  try {
    res.json(service.updateLiveOrderSetting(req.userId, req.body?.liveOrderEnabled === true));
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    res.json(await service.getDashboard(req.userId));
  } catch (error) {
    next(error);
  }
});

router.get('/account-summary', async (req, res, next) => {
  try {
    res.json(await service.getAccountSummary(req.userId, Number(req.query.strategyId)));
  } catch (error) {
    next(error);
  }
});

router.get('/buying-power-preview', async (req, res, next) => {
  try {
    res.json(await service.getBuyingPowerPreview(req.userId, {
      market: req.query.market,
      symbol: req.query.symbol,
      exchange: req.query.exchange
    }));
  } catch (error) {
    next(error);
  }
});

router.post('/strategies', (req, res, next) => {
  try {
    res.status(201).json(service.createStrategy(req.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get('/strategies', (req, res, next) => {
  try {
    res.json(service.listStrategies(req.userId));
  } catch (error) {
    next(error);
  }
});

router.get('/strategies/:id', (req, res, next) => {
  try {
    res.json(service.getStrategy(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.put('/strategies/:id', (req, res, next) => {
  try {
    res.json(service.updateStrategy(req.userId, Number(req.params.id), req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.delete('/strategies/:id', (req, res, next) => {
  try {
    service.deleteStrategy(req.userId, Number(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/strategies/:id/start', (req, res, next) => {
  try {
    res.json(service.startStrategy(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.post('/strategies/:id/stop', (req, res, next) => {
  try {
    res.json(service.stopStrategy(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.post('/strategies/:id/evaluate', async (req, res, next) => {
  try {
    res.json(await service.evaluateStrategy(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.get('/strategies/:id/orders', (req, res, next) => {
  try {
    res.json(service.listOrders(req.userId, Number(req.params.id), req.query));
  } catch (error) {
    next(error);
  }
});

router.get('/strategies/:id/decisions', (req, res, next) => {
  try {
    res.json(service.listDecisionLogs(req.userId, Number(req.params.id), req.query));
  } catch (error) {
    next(error);
  }
});

router.get('/strategies/:id/positions', (req, res, next) => {
  try {
    res.json(service.listPositionSnapshots(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.get('/orders', (req, res, next) => {
  try {
    res.json(service.listOrders(req.userId, null, req.query));
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:id', (req, res, next) => {
  try {
    res.json(service.getOrder(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/refresh', async (req, res, next) => {
  try {
    res.json(await service.refreshOrder(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

export default router;
