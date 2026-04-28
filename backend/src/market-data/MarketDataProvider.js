export class MarketDataProvider {
  async getCurrentPrice(stockCode) {
    throw new Error(`getCurrentPrice not implemented for ${stockCode}`);
  }

  async getDailyPrices(stockCode) {
    throw new Error(`getDailyPrices not implemented for ${stockCode}`);
  }
}
