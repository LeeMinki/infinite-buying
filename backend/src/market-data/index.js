import { env } from '../config/env.js';
import { KiwoomMarketDataProvider } from './KiwoomMarketDataProvider.js';
import * as kiwoomAuthService from '../services/kiwoomAuthService.js';
import * as credentialsRepository from '../repositories/kiwoomCredentialsRepository.js';

export function createMarketDataProvider(userId) {
  const credential = credentialsRepository.getByUserId(userId);
  if (!credential) {
    const error = new Error('키움 API 설정이 필요합니다. 키움 설정 화면에서 App Key와 Secret Key를 먼저 저장해 주세요.');
    error.status = 400;
    throw error;
  }
  if (credential.environment !== 'production') {
    const error = new Error('운영 키움 API 설정이 필요합니다. 키움 설정을 다시 저장해 주세요.');
    error.status = 400;
    throw error;
  }

  return new KiwoomMarketDataProvider({
    baseUrl: kiwoomAuthService.baseUrl(credential),
    timeoutMs: env.kiwoomTimeoutMs,
    tokenSupplier: () => kiwoomAuthService.getAccessToken(userId)
  });
}
