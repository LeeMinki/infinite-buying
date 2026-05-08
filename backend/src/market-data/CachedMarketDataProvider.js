import * as marketPriceCacheRepository from '../repositories/marketPriceCacheRepository.js';

export class CachedMarketDataProvider {
  constructor(userId) {
    if (!userId) {
      throw new Error('CachedMarketDataProvider requires userId');
    }
    this.userId = userId;
  }

  listDailyPrices(stockCode, { from, to } = {}) {
    return marketPriceCacheRepository.listDailyPrices(this.userId, stockCode, { from, to });
  }
}
