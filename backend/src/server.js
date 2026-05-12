import { createApp } from './app.js';
import { env, validateEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { startAutoTradingScheduler } from './services/autoTradingScheduler.js';

validateEnv();
runMigrations();
const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`Backend listening on http://localhost:${env.port}`);
});

startAutoTradingScheduler();

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${env.port} is already in use. Stop the existing server or run with PORT=4001 npm run dev.`);
    process.exit(1);
  }
  throw error;
});
