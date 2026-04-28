import { env } from '../config/env.js';
import { KiwoomMarketDataProvider } from './KiwoomMarketDataProvider.js';
import { MockMarketDataProvider } from './MockMarketDataProvider.js';

export function createMarketDataProvider() {
  const mockProvider = new MockMarketDataProvider();
  if (env.marketDataProvider !== 'kiwoom') {
    return mockProvider;
  }

  const provider = new KiwoomMarketDataProvider({
    baseUrl: env.kiwoomUseMock ? env.kiwoomMockBaseUrl : env.kiwoomBaseUrl,
    appKey: env.kiwoomAppKey,
    secretKey: env.kiwoomSecretKey,
    timeoutMs: env.kiwoomTimeoutMs
  });

  return provider.isConfigured() ? provider : mockProvider;
}
