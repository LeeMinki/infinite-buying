import { createMarketDataProvider } from '../market-data/index.js';
import * as marketPriceCacheRepository from '../repositories/marketPriceCacheRepository.js';

const COVERAGE_TOLERANCE_DAYS = 5;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export async function getCurrentPrice(userId, stockCode) {
  const provider = createMarketDataProvider(userId);
  return provider.getCurrentPrice(normalizeStockCode(stockCode));
}

export async function getDailyPrices(userId, stockCode, options = {}) {
  const normalized = normalizeStockCode(stockCode);
  const requireReal = options.requireReal === true || options.requireReal === 'true';
  const refresh = options.refresh === true || options.refresh === 'true';

  const cached = marketPriceCacheRepository.listDailyPrices(userId, normalized, options);
  const usableCached = requireReal ? cached.filter((row) => isKiwoomSource(row.source)) : cached;

  if (!refresh && hasCoverage(usableCached, options)) {
    return usableCached;
  }

  try {
    const provider = createMarketDataProvider(userId);
    const fetched = await provider.getDailyPrices(normalized, options);
    const filtered = filterByRange(fetched, options);
    if (requireReal && filtered.some((row) => !isKiwoomSource(row.source))) {
      const error = new Error('실제 과거 가격 데이터를 가져오지 못했습니다. 키움 설정과 서버 IP 등록 상태를 확인해 주세요.');
      error.status = 400;
      throw error;
    }
    marketPriceCacheRepository.upsertDailyPrices(userId, filtered);
    const stored = marketPriceCacheRepository.listDailyPrices(userId, normalized, options);
    return requireReal ? stored.filter((row) => isKiwoomSource(row.source)) : stored;
  } catch (error) {
    if (!refresh && usableCached.length > 0) return usableCached;
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

function isKiwoomSource(source) {
  return String(source || '').toUpperCase() === 'KIWOOM';
}

function hasCoverage(rows, { from, to } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  if (!from || !to) return rows.length > 0;
  const min = rows[0].date;
  const max = rows[rows.length - 1].date;
  return daysBetween(from, min) <= COVERAGE_TOLERANCE_DAYS
    && daysBetween(to, max) <= COVERAGE_TOLERANCE_DAYS;
}

function daysBetween(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.abs(ta - tb) / MS_PER_DAY;
}
