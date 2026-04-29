import { env } from '../config/env.js';
import { KiwoomMarketDataProvider } from './KiwoomMarketDataProvider.js';
import { MockMarketDataProvider } from './MockMarketDataProvider.js';
import * as kiwoomAuthService from '../services/kiwoomAuthService.js';
import * as credentialsRepository from '../repositories/kiwoomCredentialsRepository.js';

export function createMarketDataProvider(userId) {
  if (env.marketDataProvider !== 'kiwoom') {
    return new MockMarketDataProvider();
  }
  const credential = credentialsRepository.getByUserId(userId);
  if (!credential) {
    const error = new Error('Kiwoom credential is not configured. 수동 현재가 입력은 계속 사용할 수 있습니다.');
    error.status = 400;
    throw error;
  }

  return new KiwoomMarketDataProvider({
    baseUrl: kiwoomAuthService.baseUrl(credential),
    timeoutMs: env.kiwoomTimeoutMs,
    useMockData: env.kiwoomUseMock || credential.environment === 'mock',
    tokenSupplier: () => kiwoomAuthService.getAccessToken(userId)
  });
}
