import { MarketDataProvider } from './MarketDataProvider.js';

export class MockMarketDataProvider extends MarketDataProvider {
  async getCurrentPrice(stockCode) {
    const price = mockPrice(stockCode);
    return {
      stockCode,
      price,
      source: 'mock',
      fetchedAt: new Date().toISOString()
    };
  }

  async getDailyPrices(stockCode) {
    const base = mockPrice(stockCode);
    const today = new Date();
    return Array.from({ length: 60 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (59 - index));
      const wave = Math.sin(index / 4) * 0.035;
      const close = Math.max(1000, Math.round(base * (1 + wave + index * 0.0008)));
      const open = Math.round(close * (1 - 0.01));
      const high = Math.round(close * 1.018);
      const low = Math.round(close * 0.982);
      return {
        stockCode,
        date: date.toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
        volume: 1000000 + index * 12000
      };
    });
  }
}

function mockPrice(stockCode) {
  const digits = String(stockCode).replace(/\D/g, '');
  const seed = digits ? Number(digits.slice(-4)) : 5930;
  return 45000 + (seed % 30000);
}
