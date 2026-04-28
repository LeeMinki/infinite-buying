import { createMarketDataProvider } from '../market-data/index.js';

const provider = createMarketDataProvider();

export async function getCurrentPrice(stockCode) {
  return provider.getCurrentPrice(stockCode);
}

export async function getDailyPrices(stockCode) {
  return provider.getDailyPrices(stockCode);
}
