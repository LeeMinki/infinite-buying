import { MarketDataProvider } from './MarketDataProvider.js';

export class MockMarketDataProvider extends MarketDataProvider {
  async getCurrentPrice(stockCode) {
    const price = mockPrice(stockCode);
    return {
      stockCode,
      price,
      source: 'MOCK',
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
        volume: 1000000 + index * 12000,
        source: 'MOCK'
      };
    });
  }

  async searchStocks(query) {
    const keyword = String(query || '').trim().toLowerCase();
    if (!keyword) return [];
    return MOCK_STOCKS
      .filter((stock) =>
        stock.stockCode.toLowerCase().includes(keyword) ||
        stock.stockName.toLowerCase().includes(keyword)
      )
      .slice(0, 10)
      .map((stock) => ({ ...stock, source: 'MOCK' }));
  }

  async getAccountDeposit() {
    return {
      deposit: 5000000,
      availableOrderAmount: 4500000,
      source: 'MOCK',
      fetchedAt: new Date().toISOString()
    };
  }
}

const MOCK_STOCKS = [
  { stockCode: '005930', stockName: '삼성전자' },
  { stockCode: '000660', stockName: 'SK하이닉스' },
  { stockCode: '035420', stockName: 'NAVER' },
  { stockCode: '035720', stockName: '카카오' },
  { stockCode: '005380', stockName: '현대차' },
  { stockCode: '051910', stockName: 'LG화학' },
  { stockCode: 'TQQQ', stockName: 'ProShares UltraPro QQQ' },
  { stockCode: 'SOXL', stockName: 'Direxion Daily Semiconductor Bull 3X Shares' }
];

function mockPrice(stockCode) {
  const digits = String(stockCode).replace(/\D/g, '');
  const seed = digits ? Number(digits.slice(-4)) : 5930;
  return 45000 + (seed % 30000);
}
