import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import * as virtualOrdersService from '../services/virtualOrdersService.js';

const router = Router();
router.use(requireAuth);

router.post('/:id/fill', (req, res, next) => {
  try {
    res.json(virtualOrdersService.fillOrder(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', (req, res, next) => {
  try {
    res.json(virtualOrdersService.cancelOrder(req.userId, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

export default router;
