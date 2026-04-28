import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || 'data/app.db',
  marketDataProvider: process.env.MARKET_DATA_PROVIDER || 'mock',
  kiwoomBaseUrl: process.env.KIWOOM_BASE_URL || 'https://api.kiwoom.com',
  kiwoomMockBaseUrl: process.env.KIWOOM_MOCK_BASE_URL || 'https://mockapi.kiwoom.com',
  kiwoomAppKey: process.env.KIWOOM_APP_KEY || '',
  kiwoomSecretKey: process.env.KIWOOM_SECRET_KEY || '',
  kiwoomTimeoutMs: Number(process.env.KIWOOM_TIMEOUT_MS || 5000),
  kiwoomUseMock: process.env.KIWOOM_USE_MOCK === 'true'
};
