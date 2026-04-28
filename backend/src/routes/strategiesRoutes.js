import { Router } from 'express';
import * as strategiesService from '../services/strategiesService.js';
import * as virtualOrdersService from '../services/virtualOrdersService.js';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    res.json(strategiesService.listStrategies());
  } catch (error) {
    next(error);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(strategiesService.createStrategy(req.body));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(strategiesService.getStrategyOrThrow(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    res.json(strategiesService.updateStrategy(Number(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    strategiesService.deleteStrategy(Number(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/:id/holding', (req, res, next) => {
  try {
    res.json(strategiesService.getHolding(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/evaluate', (req, res, next) => {
  try {
    res.json(virtualOrdersService.evaluate(Number(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/orders', (req, res, next) => {
  try {
    res.json(virtualOrdersService.listOrders(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/logs', (req, res, next) => {
  try {
    res.json(virtualOrdersService.listLogs(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

export default router;
