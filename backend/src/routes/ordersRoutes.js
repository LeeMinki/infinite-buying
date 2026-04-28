import { Router } from 'express';
import * as virtualOrdersService from '../services/virtualOrdersService.js';

const router = Router();

router.post('/:id/fill', (req, res, next) => {
  try {
    res.json(virtualOrdersService.fillOrder(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', (req, res, next) => {
  try {
    res.json(virtualOrdersService.cancelOrder(Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

export default router;
