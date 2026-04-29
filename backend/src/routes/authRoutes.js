import { Router } from 'express';
import * as authService from '../auth/authService.js';
import { requireAuth } from '../auth/authMiddleware.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const user = await authService.register(req.body || {});
    req.session.userId = user.id;
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const user = await authService.login(req.body || {});
    req.session.userId = user.id;
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('ib.sid');
    res.status(204).end();
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
