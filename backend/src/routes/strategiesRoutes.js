import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import * as strategiesService from '../services/strategiesService.js';
import * as virtualOrdersService from '../services/virtualOrdersService.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res, next) => {
  try {
    res.json(strategiesService.listStrategies(req.userId));
  } catch (error) {
    next(error);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(strategiesService.createStrategy(req.userId, req.body));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(strategiesService.getStrategyOrThrow(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    res.json(strategiesService.updateStrategy(req.userId, Number(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    strategiesService.deleteStrategy(req.userId, Number(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/:id/holding', (req, res, next) => {
  try {
    res.json(strategiesService.getHolding(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/evaluate', (req, res, next) => {
  try {
    res.json(virtualOrdersService.evaluate(req.userId, Number(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/orders', (req, res, next) => {
  try {
    res.json(virtualOrdersService.listOrders(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/logs', (req, res, next) => {
  try {
    res.json(virtualOrdersService.listLogs(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

export default router;
