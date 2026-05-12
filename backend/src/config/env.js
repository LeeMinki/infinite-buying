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

  if (env.enableLiveOrder !== 'false') {
    errors.push('ENABLE_LIVE_ORDER must remain false. Real broker order APIs are not supported.');
  }
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
