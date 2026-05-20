import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { createSessionMiddleware } from './auth/sessionStore.js';
import authRoutes from './routes/authRoutes.js';
import kisSettingsRoutes from './routes/kisSettingsRoutes.js';
import strategiesRoutes from './routes/strategiesRoutes.js';
import marketRoutes from './routes/marketRoutes.js';
import ordersRoutes from './routes/ordersRoutes.js';
import backtestRoutes from './routes/backtestRoutes.js';
import autoTradingRoutes from './routes/autoTradingRoutes.js';
import krRankRoutes from './routes/krRankRoutes.js';
import usRankRoutes from './routes/usRankRoutes.js';

export function createApp() {
  const app = express();
  if (env.sessionCookieSecure) {
    app.set('trust proxy', 1);
  }
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(createSessionMiddleware());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, enableLiveOrder: env.enableLiveOrder === 'true' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/settings/kis', kisSettingsRoutes);
  app.use('/api/strategies', strategiesRoutes);
  app.use('/api/market', marketRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/backtests', backtestRoutes);
  app.use('/api/auto-trading', autoTradingRoutes);
  app.use('/api/kr-rank', krRankRoutes);
  app.use('/api/us-rank', usRankRoutes);

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Internal server error'
    });
  });

  return app;
}
