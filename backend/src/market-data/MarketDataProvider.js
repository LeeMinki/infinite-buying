export class MarketDataProvider {
  async getCurrentPrice(stockCode) {
    throw new Error(`getCurrentPrice not implemented for ${stockCode}`);
  }

  async getDailyPrices(stockCode) {
    throw new Error(`getDailyPrices not implemented for ${stockCode}`);
  }

  async searchStocks(query) {
    throw new Error(`searchStocks not implemented for ${query}`);
  }

  async getAccountDeposit() {
    throw new Error('getAccountDeposit not implemented');
  }
}
