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
      // 상한가(가격제한폭 상단). 시장가 매수는 KIS가 상한가로 증거금을 잡으므로 수량 산정에 쓴다.
      upperLimitPrice: normalizeNumber(row.stck_mxpr ?? row.mxpr),
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

  // 국내주식 당일 분봉 (FHKST03010200). 최대 30봉, 최근 봉 위주로 반환.
  // 반환은 시간순(과거 → 현재) 배열. 매수 필터(VWAP·거래량 추세·장대 음봉 등)에 사용한다.
  async getDomesticTodayMinuteCandles(symbol, options = {}) {
    const hour = String(options.hour || nowHourHms()).padStart(6, '0');
    const data = await this.requestJson('/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice', {
      trId: 'FHKST03010200',
      query: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
        FID_INPUT_HOUR_1: hour,
        FID_PW_DATA_INCU_YN: 'N',
        FID_ETC_CLS_CODE: ''
      }
    });
    const rows = Array.isArray(data?.output2) ? data.output2 : [];
    const normalized = rows
      .map((row) => normalizeMinuteCandle(row))
      .filter(Boolean)
      // KIS 응답은 최신 봉이 앞에 오므로 시간 오름차순으로 재정렬.
      .sort((a, b) => a.time.localeCompare(b.time));
    return normalized;
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

  // 한국주식 호가 조회 (KIS 주식현재가 호가/예상체결).
  // 매도호가(askp1~10)·매수호가(bidp1~10) 사다리를 받아온다. 연속 호가의 간격이
  // 곧 그 종목의 실제 호가 단위라, 주문 단가를 호가 단위에 맞출 때 쓴다.
  async getDomesticOrderbook(symbol) {
    const data = await this.requestJson('/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn', {
      trId: 'FHKST01010200',
      query: {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: normalizeSymbol(symbol)
      }
    });
    const row = data.output1 || data.output || data;
    const askPrices = [];
    const bidPrices = [];
    for (let i = 1; i <= 10; i += 1) {
      const ask = normalizeNumber(row[`askp${i}`]);
      const bid = normalizeNumber(row[`bidp${i}`]);
      if (ask) askPrices.push(ask);
      if (bid) bidPrices.push(bid);
    }
    // 호가 단위 = 연속한 호가의 간격. 매도호가는 오름차순, 매수호가는 내림차순으로 들어온다.
    let tick = 0;
    const sortedAsk = [...askPrices].sort((a, b) => a - b);
    for (let i = 1; i < sortedAsk.length && !tick; i += 1) {
      const gap = sortedAsk[i] - sortedAsk[i - 1];
      if (gap > 0) tick = gap;
    }
    if (!tick) {
      const sortedBid = [...bidPrices].sort((a, b) => a - b);
      for (let i = 1; i < sortedBid.length && !tick; i += 1) {
        const gap = sortedBid[i] - sortedBid[i - 1];
        if (gap > 0) tick = gap;
      }
    }
    return { symbol: normalizeSymbol(symbol), tick, askPrices, bidPrices };
  }

  // 한국주식 등락률 순위 (KIS 국내주식 등락률 순위 API).
  // 상승률 기준 내림차순으로 정렬된 종목 목록을 반환한다.
  // 응답 필드명은 KIS 실응답에 따라 달라질 수 있어 여러 후보 키를 방어적으로 읽는다.
  async getDomesticFluctuationRanking(options = {}) {
    const data = await this.requestJson('/uapi/domestic-stock/v1/ranking/fluctuation', {
      trId: 'FHPST01700000',
      query: {
        fid_cond_mrkt_div_code: 'J',
        fid_cond_scr_div_code: '20170',
        fid_input_iscd: options.marketCode || '0000', // 0000 전체 / 0001 코스피 / 1001 코스닥
        fid_rank_sort_cls_code: '0', // 0 = 상승률순
        fid_input_cnt_1: '0',
        fid_prc_cls_code: '0',
        fid_input_price_1: '',
        fid_input_price_2: '',
        fid_vol_cnt: '',
        fid_trgt_cls_code: '0',
        fid_trgt_exls_cls_code: '0',
        fid_div_cls_code: '0',
        fid_rsfl_rate1: '',
        fid_rsfl_rate2: ''
      }
    });
    const rows = pickRankingArray(data)
      .map((row) => {
        const symbol = String(row.stck_shrn_iscd ?? row.mksc_shrn_iscd ?? row.iscd ?? '').trim();
        const price = normalizeNumber(row.stck_prpr ?? row.price);
        if (!symbol || !price) return null;
        return {
          symbol,
          name: String(row.hts_kor_isnm ?? row.prdt_name ?? row.name ?? '').trim() || symbol,
          market: 'KR',
          price,
          // prdy_ctrt(전일대비율)은 퍼센트 단위. 0.295 같은 소수 비율로 정규화한다.
          fluctuationRate: normalizeSignedNumber(row.prdy_ctrt ?? row.fltt_rt ?? row.rate) / 100,
          source: 'KIS_API'
        };
      })
      .filter(Boolean);
    rows.sort((a, b) => b.fluctuationRate - a.fluctuationRate);
    return rows;
  }

  // 해외주식 상승율/하락율 (KIS 해외주식-041).
  // KIS 문서: GET /uapi/overseas-stock/v1/ranking/updown-rate, TR HHDFS76290000.
  // GUBN=1 상승율, GUBN=0 하락율. 이 앱은 상승률 랭킹만 사용한다.
  async getOverseasFluctuationRanking(options = {}) {
    const exchanges = normalizeRankingExchanges(options.exchange);
    const rows = [];
    for (const exchange of exchanges) {
      const data = await this.requestJson('/uapi/overseas-stock/v1/ranking/updown-rate', {
        trId: 'HHDFS76290000',
        query: {
          KEYB: '',
          AUTH: '',
          EXCD: exchange,
          GUBN: '1',     // 1 = 상승율
          NDAY: '0',     // 0 = 당일 기준
          VOL_RANG: '6'  // 6 = 1000만주 이상
        }
      });
      for (const row of pickRankingArray(data)) {
        const symbol = String(row.symb ?? row.symbol ?? row.pdno ?? '').trim().toUpperCase();
        const price = normalizeNumber(row.last ?? row.price ?? row.ovrs_nmix_prpr ?? row.stck_prpr);
        const volume = normalizeNumber(row.tvol ?? row.volume ?? row.acml_vol ?? row.trd_vol ?? row.trade_vol ?? row.evol);
        const rawRate = row.rate ?? row.prdy_ctrt ?? row.fluctuationRate;
        if (rawRate === undefined || rawRate === null || rawRate === '') continue;
        const rate = normalizeSignedNumber(rawRate);
        if (!symbol || !price || !Number.isFinite(rate)) continue;
        rows.push({
          symbol,
          name: String(row.name ?? row.ename ?? row.prdt_name ?? symbol).trim() || symbol,
          market: 'US',
          exchange,
          price,
          volume,
          fluctuationRate: rate / 100,
          rank: normalizeNumber(row.rank) || null,
          source: 'KIS_API'
        });
      }
    }
    rows.sort((a, b) => b.fluctuationRate - a.fluctuationRate);
    return rows;
  }

  // 국내휴장일조회 (국내주식-040). TR CTCA0903R, GET /uapi/domestic-stock/v1/quotations/chk-holiday.
  // opnd_yn(개장일여부 Y/N)로 주식시장 개장 여부를 판단한다. KIS 안내: 1일 1회 호출 권장.
  // baseDate(YYYYMMDD) 이후 약 한 달치 영업일 정보를 output 배열로 돌려준다.
  async getDomesticHolidays(baseDate) {
    const data = await this.requestJson('/uapi/domestic-stock/v1/quotations/chk-holiday', {
      trId: 'CTCA0903R',
      query: { BASS_DT: baseDate, CTX_AREA_NK: '', CTX_AREA_FK: '' }
    });
    const rows = Array.isArray(data?.output) ? data.output : [];
    return rows
      .map((row) => ({
        date: String(row.bass_dt ?? '').trim(), // YYYYMMDD
        isOpen: String(row.opnd_yn ?? '').trim().toUpperCase() === 'Y'
      }))
      .filter((row) => row.date);
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
            tr_id: trId,
            // 해외주식 상승율/하락율 등 일부 TR은 custtype을 필수로 요구한다 (개인=P).
            custtype: 'P'
          },
          signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || isFailureResponse(data)) {
          const status = response.status >= 400 ? response.status : 502;
          // KIS 응답 진단 필드(rt_cd, msg_cd, msg1)를 에러 메시지에 포함해야
          // 판단 로그에서 KIS API 거절 원인을 바로 확인할 수 있다.
          const kisMessage = String(data?.msg1 || data?.msg || '').trim();
          const detail = [
            `HTTP ${response.status}`,
            data?.rt_cd != null ? `rt_cd=${data.rt_cd}` : null,
            data?.msg_cd ? `msg_cd=${data.msg_cd}` : null,
            kisMessage || null
          ].filter(Boolean).join(', ');
          const err = new Error(detail ? `${MARKET_ERROR_MESSAGE} (${detail})` : MARKET_ERROR_MESSAGE);
          err.status = status;
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
        // KIS rt_cd/msg1 등 진단 정보를 담은 에러는 그대로 위로 던진다.
        if (error.message?.startsWith(MARKET_ERROR_MESSAGE)) throw error;
        const wrapped = new Error(`${MARKET_ERROR_MESSAGE} (${error.message || 'fetch error'})`);
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

function pickRankingArray(data) {
  if (!data || typeof data !== 'object') return [];
  for (const key of ['output', 'output1', 'output2', 'list']) {
    if (Array.isArray(data[key])) return data[key];
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

// 부호를 보존하는 숫자 파싱 (등락률은 음수일 수 있다).
function normalizeSignedNumber(value) {
  if (value === undefined || value === null || value === '') return Number.NaN;
  const number = Number(String(value).replace(/,/g, '').replace('%', '').replace('+', '').trim());
  return Number.isFinite(number) ? number : Number.NaN;
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

function normalizeRankingExchanges(value) {
  const raw = String(value || 'NAS').trim().toUpperCase();
  if (!raw || raw === 'ALL') return uniqueExchanges();
  const exchange = normalizeExchange(raw);
  return uniqueExchanges().includes(exchange) ? [exchange] : [exchange];
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

// KST 기준 'HHMMSS' 문자열. KIS 분봉 조회의 FID_INPUT_HOUR_1 기본값으로 사용.
function nowHourHms() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hh = String(kst.getHours()).padStart(2, '0');
  const mm = String(kst.getMinutes()).padStart(2, '0');
  const ss = String(kst.getSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}

// KIS 분봉 응답(output2 한 행)을 매수 필터에서 쓰는 표준 형태로 정규화.
function normalizeMinuteCandle(row) {
  if (!row || typeof row !== 'object') return null;
  const time = String(row.stck_cntg_hour ?? row.cntg_hour ?? '').padStart(6, '0');
  if (!/^\d{6}$/.test(time)) return null;
  const open = normalizeNumber(row.stck_oprc);
  const high = normalizeNumber(row.stck_hgpr);
  const low = normalizeNumber(row.stck_lwpr);
  const close = normalizeNumber(row.stck_prpr);
  const volume = normalizeNumber(row.cntg_vol);
  if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) return null;
  return { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
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
