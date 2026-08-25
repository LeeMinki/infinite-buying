import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const generatedDevEncryptionKey = Buffer.alloc(32, 7).toString('base64');
const generatedDevSessionSecret = 'development-session-secret-change-before-deploy';

function parsePositiveIntegerList(value) {
  return String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
}

export const env = {
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || 'data/app.db',
  kisApiBaseUrl: process.env.KIS_API_BASE_URL || 'https://openapi.koreainvestment.com:9443',
  kisTimeoutMs: Number(process.env.KIS_TIMEOUT_MS || 5000),
  autoTradingSchedulerEnabled: process.env.AUTO_TRADING_SCHEDULER_ENABLED !== 'false',
  autoTradingSchedulerIntervalMs: Number(process.env.AUTO_TRADING_SCHEDULER_INTERVAL_MS || 600_000),
  // 한국 국장 상승률 랭킹 전략은 진입 시각(09:10·11:30)을 놓치지 않도록 30초 간격으로 평가한다.
  krRankSchedulerIntervalMs: Number(process.env.KR_RANK_SCHEDULER_INTERVAL_MS || 30_000),
  // 과거 time-split에서 수익성을 통과하지 못한 5분 live 후보 재탐색은 기본 비활성이다.
  // false여도 실제 랭킹은 5분 동안 shadow 관찰로 저장해 독립 validation 자료를 만든다.
  krRankLiveEntryRetryEnabled: process.env.KR_RANK_LIVE_ENTRY_RETRY_ENABLED === 'true',
  // 명시적으로 지정한 KR 전략에만 오전 core fallback을 허용한다. 빈 값이면 완전히 비활성이다.
  // 수익 보장 규칙이 아니라 장기 무주문을 피하기 위한 제한된 canary이므로 전역 boolean으로 열지 않는다.
  krRankCoreFallbackStrategyIds: parsePositiveIntegerList(process.env.KR_RANK_CORE_FALLBACK_STRATEGY_IDS),
  // 라오어는 ACCEPTED/FILLED 분리와 외부 동일종목 provenance 보강 전까지 production live를 잠근다.
  laorLiveOrderEnabled: process.env.LAOR_LIVE_ORDER_ENABLED === 'true',
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
