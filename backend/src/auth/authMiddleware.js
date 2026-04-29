import * as usersRepository from '../repositories/usersRepository.js';
import { safeUser } from './authService.js';

export function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const user = usersRepository.getUserById(userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = safeUser(user);
  req.userId = user.id;
  return next();
}
