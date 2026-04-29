import { createMarketDataProvider } from '../market-data/index.js';
import * as marketPriceCacheRepository from '../repositories/marketPriceCacheRepository.js';

export async function getCurrentPrice(userId, stockCode) {
  const provider = createMarketDataProvider(userId);
  return provider.getCurrentPrice(normalizeStockCode(stockCode));
}

export async function getDailyPrices(userId, stockCode, options = {}) {
  const normalized = normalizeStockCode(stockCode);
  const cached = marketPriceCacheRepository.listDailyPrices(userId, normalized, options);
  try {
    const provider = createMarketDataProvider(userId);
    const fetched = await provider.getDailyPrices(normalized, options);
    const filtered = filterByRange(fetched, options);
    marketPriceCacheRepository.upsertDailyPrices(userId, filtered);
    return marketPriceCacheRepository.listDailyPrices(userId, normalized, options);
  } catch (error) {
    if (cached.length > 0) return cached;
    throw error;
  }
}

export async function searchStocks(userId, query) {
  const provider = createMarketDataProvider(userId);
  return provider.searchStocks(String(query || '').trim());
}

export async function getAccountDeposit(userId) {
  const provider = createMarketDataProvider(userId);
  return provider.getAccountDeposit();
}

function normalizeStockCode(stockCode) {
  return String(stockCode || '').trim();
}

function filterByRange(rows, { from, to } = {}) {
  return rows.filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
}
