import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import * as backtestService from '../services/backtestService.js';

const router = Router();
router.use(requireAuth);

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(backtestService.createRun(req.userId, req.body));
  } catch (error) {
    next(error);
  }
});

router.get('/', (req, res, next) => {
  try {
    res.json(backtestService.listRuns(req.userId));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(backtestService.getRun(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/trades', (req, res, next) => {
  try {
    res.json(backtestService.listTrades(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    backtestService.deleteRun(req.userId, Number(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
