import { env } from '../config/env.js';
import { getAuthContext } from '../services/kisAuthService.js';

const DEFAULT_EXCHANGE = 'NAS';
const MARKET_ERROR_MESSAGE = '시세 조회에 실패했습니다. 종목, 기간, KIS API 상태를 확인하세요';
const EMPTY_DAILY_MESSAGE = '해당 기간의 일봉 데이터가 없습니다';
const US_PRODUCT_TYPES = [
  { code: '512', exchange: 'NAS', marketName: 'NASDAQ' },
  { code: '513', exchange: 'NYS', marketName: 'NYSE' },
  { code: '529', exchange: 'AMS', marketName: 'AMEX' }
];

export class KisMarketDataProvider {
  constructor(userId) {
    this.userId = userId;
  }

  async getCurrentPrice(symbol, options = {}) {
    const normalized = normalizeSymbol(symbol);
    const market = normalizeMarket(options.market, normalized);
    if (market === 'KR') return this.getDomesticCurrentPrice(normalized);
    return this.getOverseasCurrentPrice(normalized, options);
  }

  async getDomesticCurrentPrice(symbol) {
    const data = await this.requestJson('/uapi/domestic-stock/v1/quotations/inquire-price', {
      trId: 'FHKST01010100',
      query: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol
      }
    });
    const row = data.output || data.output1 || data;
    const price = normalizeNumber(row.stck_prpr ?? row.price ?? row.close);
    if (!price) throw marketError();
    return {
      symbol,
      name: String(row.hts_kor_isnm ?? row.prdt_name ?? row.name ?? '').trim() || symbol,
      market: 'KR',
      exchange: 'KRX',
      price,
      previousClose: normalizeNumber(row.prdy_clpr ?? row.stck_sdpr ?? row.base ?? row.prev_close),
      currency: 'KRW',
      source: 'KIS_API',
      fetchedAt: new Date().toISOString()
    };
  }

  async getOverseasCurrentPrice(symbol, options = {}) {
    const exchanges = options.exchange ? [normalizeExchange(options.exchange)] : uniqueExchanges();
    let lastError = null;
    for (const exchange of exchanges) {
      try {
        return await this.getOverseasCurrentPriceForExchange(symbol, exchange);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || marketError();
  }

  async getOverseasCurrentPriceForExchange(symbol, exchange) {
    const data = await this.requestJson('/uapi/overseas-price/v1/quotations/price', {
      trId: 'HHDFS00000300',
      query: {
        AUTH: '',
        EXCD: exchange,
        SYMB: symbol
      }
    });
    const row = data.output || data.output1 || data;
    const price = normalizeNumber(
      row.last ?? row.price ?? row.ovrs_nmix_prpr ?? row.stck_prpr ?? row.last_price ?? row.close
    );
    if (!price) throw marketError();
    return {
      symbol,
      name: String(row.prdt_name ?? row.prdt_eng_name ?? row.hts_eng_name ?? '').trim() || symbol,
      market: 'US',
      exchange,
      price,
      previousClose: normalizeNumber(row.base ?? row.prdy_clpr ?? row.ovrs_base_pric ?? row.last_close ?? row.prev_close),
      currency: 'USD',
      source: 'KIS_API',
      fetchedAt: new Date().toISOString()
    };
  }

  async getDailyPrices(symbol, options = {}) {
    const normalized = normalizeSymbol(symbol);
    const market = normalizeMarket(options.market, normalized);
    if (market === 'KR') return this.getDomesticDailyPrices(normalized, options);
    return this.getOverseasDailyPrices(normalized, options);
  }

  async getDomesticDailyPrices(symbol, options = {}) {
    const from = compactDate(options.from || currentDate());
    const to = compactDate(options.to || currentDate());
    const data = await this.requestJson('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice', {
      trId: 'FHKST03010100',
      query: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
        FID_INPUT_DATE_1: from,
        FID_INPUT_DATE_2: to,
        FID_PERIOD_DIV_CODE: 'D',
        FID_ORG_ADJ_PRC: '1'
      }
    });
    const rows = pickCandleArray(data).map((row) => normalizeCandle(row, {
      symbol,
      market: 'KR',
      exchange: 'KRX',
      currency: 'KRW'
    })).filter(Boolean);
    if (rows.length === 0) throw emptyDailyError();
    return rows;
  }

  async getOverseasDailyPrices(symbol, options = {}) {
    const exchanges = options.exchange ? [normalizeExchange(options.exchange)] : uniqueExchanges();
    let lastError = null;
    for (const exchange of exchanges) {
      try {
        const rows = await this.getOverseasDailyPricesForExchange(symbol, exchange, options);
        if (rows.length > 0) return rows;
      } catch (error) {
        lastError = error;
        if (error.message !== EMPTY_DAILY_MESSAGE) throw error;
      }
    }
    throw lastError || emptyDailyError();
  }

  async getOverseasDailyPricesForExchange(symbol, exchange, options = {}) {
    const rows = [];
    const seenDates = new Set();
    const from = options.from || null;
    let cursor = compactDate(options.to || currentDate());

    for (let page = 0; page < 12; page += 1) {
      const data = await this.requestJson('/uapi/overseas-price/v1/quotations/dailyprice', {
        trId: 'HHDFS76240000',
        query: {
          AUTH: '',
          EXCD: exchange,
          SYMB: symbol,
          GUBN: '0',
          BYMD: cursor,
          MODP: '0'
        }
      });
      const pageRows = pickCandleArray(data).map((row) => normalizeCandle(row, {
        symbol,
        market: 'US',
        exchange,
        currency: 'USD'
      })).filter(Boolean);
      if (pageRows.length === 0) break;
      for (const row of pageRows) {
        if (!seenDates.has(row.date)) {
          seenDates.add(row.date);
          rows.push(row);
        }
      }
      const oldest = pageRows[pageRows.length - 1]?.date;
      if (!from || !oldest || oldest <= from) break;
      cursor = compactDate(previousDate(oldest));
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length === 0) throw emptyDailyError();
    return rows;
  }

  async searchSymbols(query) {
    const keyword = String(query || '').trim();
    if (!keyword) return [];
    const items = [];

    if (/^\d{6}$/.test(keyword)) {
      try {
        const price = await this.searchDomesticInfo(keyword);
        items.push({
          symbol: price.symbol,
          name: price.name,
          market: price.market,
          exchange: price.exchange,
          currency: price.currency,
          source: price.source
        });
      } catch {}
    }

    if (/^[A-Za-z0-9.-]{1,12}$/.test(keyword)) {
      const overseas = await Promise.all(US_PRODUCT_TYPES.map((type) => (
        this.searchOverseasInfo(keyword.toUpperCase(), type).catch(() => null)
      )));
      for (const item of overseas.filter(Boolean)) items.push(item);
      if (items.length === 0) {
        items.push({
          symbol: keyword.toUpperCase(),
          name: keyword.toUpperCase(),
          market: 'US',
          exchange: DEFAULT_EXCHANGE,
          currency: 'USD',
          source: 'KIS_API'
        });
      }
    }

    return dedupeSymbols(items).slice(0, 10);
  }

  async searchDomesticInfo(symbol) {
    const data = await this.requestJson('/uapi/domestic-stock/v1/quotations/search-stock-info', {
      trId: 'CTPF1002R',
      query: {
        PRDT_TYPE_CD: '300',
        PDNO: symbol
      }
    });
    const row = data.output || data.output1 || data;
    if (!row || Object.keys(row).length === 0) return null;
    return {
      symbol,
      name: String(row.prdt_name ?? row.prdt_abrv_name ?? row.prdt_name120 ?? symbol).trim() || symbol,
      market: 'KR',
      exchange: 'KRX',
      currency: 'KRW',
      source: 'KIS_API'
    };
  }

  async searchOverseasInfo(symbol, productType) {
    const data = await this.requestJson('/uapi/overseas-price/v1/quotations/search-info', {
      trId: 'CTPF1702R',
      query: {
        PRDT_TYPE_CD: productType.code,
        PDNO: symbol
      }
    });
    const row = Array.isArray(data.output) ? data.output[0] : data.output || data.output1 || data;
    if (!row || Object.keys(row).length === 0) return null;
    return {
      symbol,
      name: String(row.prdt_eng_name ?? row.prdt_name ?? row.prdt_abrv_name ?? row.pdno ?? symbol).trim() || symbol,
      market: 'US',
      exchange: normalizeOverseasExchange(row.ovrs_excg_cd) || productType.exchange,
      marketName: String(row.ovrs_excg_name ?? productType.marketName).trim() || productType.marketName,
      currency: String(row.tr_crcy_cd || 'USD').trim() || 'USD',
      fractionalTradingAvailable: row.mint_dcpt_trad_psbl_yn === 'Y',
      buyUnitQuantity: normalizeNumber(row.buy_unit_qty) || 1,
      sellUnitQuantity: normalizeNumber(row.sll_unit_qty) || 1,
      source: 'KIS_API'
    };
  }

  async requestJson(path, { trId, query }) {
    const context = await getAuthContext(this.userId);
    const url = new URL(`${context.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      url.searchParams.set(key, value);
    }
    return requestWithRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.kisTimeoutMs);
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            authorization: `Bearer ${context.accessToken}`,
            appkey: context.appKey,
            appsecret: context.appSecret,
            tr_id: trId
          },
          signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || isFailureResponse(data)) {
          const status = response.status >= 400 ? response.status : 502;
          const err = marketError(status);
          err.transient = status >= 500 || status === 429;
          throw err;
        }
        return data;
      } catch (error) {
        if (error.name === 'AbortError') {
          const err = new Error(MARKET_ERROR_MESSAGE);
          err.status = 504;
          err.transient = true;
          throw err;
        }
        if (error.message === MARKET_ERROR_MESSAGE) throw error;
        const wrapped = new Error(MARKET_ERROR_MESSAGE);
        wrapped.status = 502;
        wrapped.transient = true;
        throw wrapped;
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}

const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [400, 900];

async function requestWithRetry(invoke) {
  let lastError;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await invoke();
    } catch (error) {
      lastError = error;
      if (!error?.transient || attempt === RETRY_ATTEMPTS - 1) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS[attempt] ?? 1500));
    }
  }
  throw lastError;
}

export { EMPTY_DAILY_MESSAGE, MARKET_ERROR_MESSAGE };

function normalizeCandle(row, context) {
  const date = normalizeDate(row.xymd ?? row.date ?? row.stck_bsop_date ?? row.base_dt);
  const open = normalizeNumber(row.open ?? row.ovrs_nmix_oprc ?? row.stck_oprc);
  const high = normalizeNumber(row.high ?? row.ovrs_nmix_hgpr ?? row.stck_hgpr);
  const low = normalizeNumber(row.low ?? row.ovrs_nmix_lwpr ?? row.stck_lwpr);
  const close = normalizeNumber(row.clos ?? row.close ?? row.ovrs_nmix_prpr ?? row.stck_clpr);
  if (!date || !open || !high || !low || !close) return null;
  return {
    symbol: context.symbol,
    market: context.market,
    exchange: context.exchange,
    date,
    open,
    high,
    low,
    close,
    volume: normalizeNumber(row.tvol ?? row.volume ?? row.acml_vol) || 0,
    currency: context.currency,
    source: 'KIS_API'
  };
}

function pickCandleArray(data) {
  if (!data || typeof data !== 'object') return [];
  for (const key of ['output2', 'output1', 'output', 'list']) {
    if (Array.isArray(data[key])) return data[key];
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function isFailureResponse(data) {
  const rtCd = data?.rt_cd ?? data?.rtCd;
  return rtCd != null && String(rtCd) !== '0';
}

function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) {
    const error = new Error('종목코드 또는 심볼을 입력하세요.');
    error.status = 400;
    throw error;
  }
  return symbol;
}

function normalizeMarket(value, symbol) {
  const market = String(value || '').trim().toUpperCase();
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') return 'KR';
  if (market === 'US') return 'US';
  return /^\d{6}$/.test(symbol) ? 'KR' : 'US';
}

function normalizeExchange(value) {
  return String(value || DEFAULT_EXCHANGE).trim().toUpperCase();
}

function uniqueExchanges() {
  return [...new Set([DEFAULT_EXCHANGE, ...US_PRODUCT_TYPES.map((type) => type.exchange)])];
}

function normalizeOverseasExchange(value) {
  const code = String(value || '').trim().toUpperCase();
  if (code === 'NASD') return 'NAS';
  if (code === 'NYSE') return 'NYS';
  if (code === 'AMEX') return 'AMS';
  return code || null;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? Math.abs(number) : 0;
}

function normalizeDate(value) {
  const text = String(value || '');
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return text.slice(0, 10);
}

function compactDate(value) {
  return String(value || '').replaceAll('-', '').slice(0, 8);
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function previousDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function marketError(status = 502) {
  const error = new Error(MARKET_ERROR_MESSAGE);
  error.status = status;
  return error;
}

function emptyDailyError() {
  const error = new Error(EMPTY_DAILY_MESSAGE);
  error.status = 404;
  return error;
}

function dedupeSymbols(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.market}:${item.exchange}:${item.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
