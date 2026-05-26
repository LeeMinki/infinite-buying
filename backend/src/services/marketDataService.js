import { KisMarketDataProvider } from '../market-data/KisMarketDataProvider.js';
import * as marketPriceCacheRepository from '../repositories/marketPriceCacheRepository.js';

const COVERAGE_TOLERANCE_DAYS = 5;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export async function getCurrentPrice(userId, symbol, options = {}) {
  const provider = new KisMarketDataProvider(userId);
  return provider.getCurrentPrice(normalizeSymbol(symbol), options);
}

export async function getDailyPrices(userId, symbol, options = {}) {
  const normalized = normalizeSymbol(symbol);
  const market = normalizeMarket(options.market, normalized);
  const cacheOptions = { ...options, market };
  const refresh = options.refresh === true || options.refresh === 'true';

  const cached = marketPriceCacheRepository.listDailyPrices(userId, normalized, cacheOptions);

  if (!refresh && hasCoverage(cached, cacheOptions)) {
    return cached;
  }

  try {
    const provider = new KisMarketDataProvider(userId);
    const fetched = await provider.getDailyPrices(normalized, cacheOptions);
    const filtered = filterByRange(fetched, cacheOptions);
    marketPriceCacheRepository.upsertDailyPrices(userId, filtered);
    const stored = marketPriceCacheRepository.listDailyPrices(userId, normalized, cacheOptions);
    if (stored.length === 0) {
      const error = new Error('해당 기간의 일봉 데이터가 없습니다');
      error.status = 404;
      throw error;
    }
    return stored;
  } catch (error) {
    // KIS가 일시적으로 불안정하면 기존 캐시가 범위를 충분히 덮을 때 캐시를 폴백으로 사용한다.
    if (hasCoverage(cached, cacheOptions)) return cached;
    if (!refresh && cached.length > 0) return cached;
    throw error;
  }
}

export async function searchSymbols(userId, query) {
  const provider = new KisMarketDataProvider(userId);
  return provider.searchSymbols(query);
}

// 한국주식 등락률 상위 랭킹. 조회 실패·빈 응답 시 에러를 그대로 상위로 전파해
// 한국 랭킹 전략의 진입 평가가 SKIP/ERROR로 기록되도록 한다.
export async function getDomesticFluctuationRanking(userId, options = {}) {
  const provider = new KisMarketDataProvider(userId);
  return provider.getDomesticFluctuationRanking(options);
}

// 해외주식 상승률 상위 랭킹. 미국장 랭킹 자동매매가 정규장 중 진입 후보를 고를 때 쓴다.
export async function getOverseasFluctuationRanking(userId, options = {}) {
  const provider = new KisMarketDataProvider(userId);
  return provider.getOverseasFluctuationRanking(options);
}

// 국내주식 당일 분봉 — 매수 후보의 단기 흐름(VWAP·거래량·장대 음봉) 검사용.
export async function getDomesticTodayMinuteCandles(userId, symbol, options = {}) {
  const provider = new KisMarketDataProvider(userId);
  return provider.getDomesticTodayMinuteCandles(normalizeSymbol(symbol), options);
}

// 국내 증시 휴장일 조회 — 자동매매가 공휴일에 매수를 시도하지 않도록 개장일 여부를 확인한다.
export async function getDomesticHolidays(userId, baseDate) {
  const provider = new KisMarketDataProvider(userId);
  return provider.getDomesticHolidays(baseDate);
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeMarket(value, symbol) {
  const market = String(value || '').trim().toUpperCase();
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') return 'KR';
  if (market === 'US') return 'US';
  return /^\d{6}$/.test(symbol) ? 'KR' : 'US';
}

function filterByRange(rows, { from, to } = {}) {
  return rows.filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
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
