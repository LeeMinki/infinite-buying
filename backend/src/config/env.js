import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const generatedDevEncryptionKey = Buffer.alloc(32, 7).toString('base64');
const generatedDevSessionSecret = 'development-session-secret-change-before-deploy';

export const env = {
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || 'data/app.db',
  kisApiBaseUrl: process.env.KIS_API_BASE_URL || 'https://openapi.koreainvestment.com:9443',
  kisTimeoutMs: Number(process.env.KIS_TIMEOUT_MS || 5000),
  autoTradingSchedulerEnabled: process.env.AUTO_TRADING_SCHEDULER_ENABLED !== 'false',
  autoTradingSchedulerIntervalMs: Number(process.env.AUTO_TRADING_SCHEDULER_INTERVAL_MS || 600_000),
  // 한국 국장 상승률 랭킹 전략은 진입 시각(09:10·11:30)을 놓치지 않도록 30초 간격으로 평가한다.
  krRankSchedulerIntervalMs: Number(process.env.KR_RANK_SCHEDULER_INTERVAL_MS || 30_000),
  // 미국장 상승률 랭킹 전략도 정규장 중 빠른 회전을 위해 30초 간격으로 평가한다.
  usRankSchedulerIntervalMs: Number(process.env.US_RANK_SCHEDULER_INTERVAL_MS || 30_000),
  secretEncryptionKey: process.env.SECRET_ENCRYPTION_KEY || generatedDevEncryptionKey,
  sessionSecret: process.env.SESSION_SECRET || generatedDevSessionSecret,
  sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === 'true',
  enableLiveOrder: process.env.ENABLE_LIVE_ORDER || 'false',
  enableReservedOrder: process.env.ENABLE_RESERVED_ORDER || 'false',
  isProduction
};

export function validateEnv() {
  const errors = [];
  const encryptionKey = Buffer.from(env.secretEncryptionKey, 'base64');

  if (env.enableReservedOrder !== 'false') {
    errors.push('ENABLE_RESERVED_ORDER must remain false. Reserved broker order APIs are not supported.');
  }
  if (encryptionKey.length !== 32) {
    errors.push('SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  if (!env.sessionSecret || env.sessionSecret.length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters.');
  }
  if (env.isProduction && !process.env.SECRET_ENCRYPTION_KEY) {
    errors.push('SECRET_ENCRYPTION_KEY is required in production.');
  }
  if (env.isProduction && !process.env.SESSION_SECRET) {
    errors.push('SESSION_SECRET is required in production.');
  }
  if (env.isProduction && !process.env.KIS_API_BASE_URL) {
    errors.push('KIS_API_BASE_URL is required in production.');
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

export function getSecretEncryptionKeyBytes() {
  return Buffer.from(env.secretEncryptionKey, 'base64');
}
