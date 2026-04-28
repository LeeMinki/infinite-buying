import express from 'express';
import cors from 'cors';
import strategiesRoutes from './routes/strategiesRoutes.js';
import marketRoutes from './routes/marketRoutes.js';
import ordersRoutes from './routes/ordersRoutes.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/strategies', strategiesRoutes);
  app.use('/api/market', marketRoutes);
  app.use('/api/orders', ordersRoutes);

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Internal server error'
    });
  });

  return app;
}
