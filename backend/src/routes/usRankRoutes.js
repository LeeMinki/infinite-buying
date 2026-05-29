import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import * as service from '../services/usRankService.js';
import { replayUsRankTrade } from '../services/rankReplayService.js';

const router = Router();
router.use(requireAuth);

router.get('/overview', (req, res, next) => {
  try {
    res.json(service.getOverview(req.userId));
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

router.post('/strategies', (req, res, next) => {
  try {
    res.status(201).json(service.createStrategy(req.userId, req.body || {}));
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

router.post('/strategies/:id/start', async (req, res, next) => {
  try {
    res.json(await service.startStrategy(req.userId, Number(req.params.id)));
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

router.post('/strategies/:id/sync-fills', async (req, res, next) => {
  try {
    const updated = await service.syncOrderFills(req.userId, {
      strategyId: Number(req.params.id),
      limit: 100
    });
    res.json({ updatedCount: updated.length, updated });
  } catch (error) {
    next(error);
  }
});

router.get('/strategies/:id/trades', (req, res, next) => {
  try {
    res.json(service.listTrades(req.userId, Number(req.params.id), req.query));
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

router.get('/strategies/:id/trade-history', (req, res, next) => {
  try {
    res.json(service.listRoundTripOrders(req.userId, Number(req.params.id), req.query));
  } catch (error) {
    next(error);
  }
});

router.post('/strategies/:id/trade-history/:tradeId/replay', async (req, res, next) => {
  try {
    service.getStrategy(req.userId, Number(req.params.id));
    res.json(await replayUsRankTrade(
      req.userId,
      Number(req.params.id),
      Number(req.params.tradeId),
      req.body || {}
    ));
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

export default router;
