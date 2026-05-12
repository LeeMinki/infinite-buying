import { env } from '../config/env.js';
import { KisMarketDataProvider } from '../market-data/KisMarketDataProvider.js';
import { getAuthContext } from './kisTokenManager.js';

const MARKET_ERROR = 'KIS 계좌 정보를 조회하지 못했습니다. KIS 설정과 계좌 정보를 확인하세요.';
const ORDER_ERROR = 'KIS 주문 요청에 실패했습니다.';

export class KisTradingService {
  constructor(userId) {
    this.userId = userId;
    this.marketData = new KisMarketDataProvider(userId);
  }

  async getCurrentPrice(symbol, options = {}) {
    return this.marketData.getCurrentPrice(symbol, options);
  }

  async getBalance(symbol, options = {}) {
    const context = await this.requireAccountContext();
    const market = normalizeMarket(options.market, symbol);
    if (market === 'KR') return this.getDomesticBalance(context, symbol);
    return this.getOverseasBalance(context, symbol, options);
  }

  async getBuyingPower(symbol, options = {}) {
    const context = await this.requireAccountContext();
    const market = normalizeMarket(options.market, symbol);
    if (market === 'KR') return this.getDomesticBuyingPower(context, symbol, options);
    return this.getOverseasBuyingPower(context, symbol, options);
  }

  async getOpenOrders(symbol, options = {}) {
    const context = await this.requireAccountContext();
    const market = normalizeMarket(options.market, symbol);
    if (market === 'KR') return this.getDomesticOpenOrders(context, symbol);
    return this.getOverseasOpenOrders(context, symbol, options);
  }

  async getOrderHistory(symbol, options = {}) {
    const context = await this.requireAccountContext();
    const market = normalizeMarket(options.market, symbol);
    if (market === 'KR') return this.getDomesticOrderHistory(context, symbol);
    return this.getOverseasOrderHistory(context, symbol, options);
  }

  async placeBuyOrder(order) {
    const context = await this.requireAccountContext();
    if (normalizeMarket(order.market, order.symbol) === 'KR') {
      return this.placeDomesticOrder(context, { ...order, side: 'BUY' });
    }
    return this.placeOverseasOrder(context, { ...order, side: 'BUY' });
  }

  async placeSellOrder(order) {
    const context = await this.requireAccountContext();
    if (normalizeMarket(order.market, order.symbol) === 'KR') {
      return this.placeDomesticOrder(context, { ...order, side: 'SELL' });
    }
    return this.placeOverseasOrder(context, { ...order, side: 'SELL' });
  }

  async refreshOrder(order) {
    const rows = await this.getOrderHistory(order.symbol, {
      market: order.market,
      exchange: order.exchange
    });
    const found = rows.find((row) => (
      (order.kisOrderNo && row.orderNo === order.kisOrderNo)
      || (order.kisOriginalOrderNo && row.originalOrderNo === order.kisOriginalOrderNo)
    ));
    if (!found) {
      const open = await this.getOpenOrders(order.symbol, { market: order.market, exchange: order.exchange });
      const openFound = open.find((row) => (
        (order.kisOrderNo && row.orderNo === order.kisOrderNo)
        || (order.kisOriginalOrderNo && row.originalOrderNo === order.kisOriginalOrderNo)
      ));
      return openFound || { status: 'UNKNOWN', responsePayloadMasked: maskPayload({ notFound: true }) };
    }
    return found;
  }

  async getDomesticBalance(context, symbol) {
    const data = await this.requestJson('/uapi/domestic-stock/v1/trading/inquire-balance', {
      method: 'GET',
      trId: 'TTTC8434R',
      context,
      query: {
        CANO: context.accountNumber,
        ACNT_PRDT_CD: context.accountProductCode,
        AFHR_FLPR_YN: 'N',
        OFL_YN: '',
        INQR_DVSN: '02',
        UNPR_DVSN: '01',
        FUND_STTL_ICLD_YN: 'N',
        FNCG_AMT_AUTO_RDPT_YN: 'N',
        PRCS_DVSN: '00',
        CTX_AREA_FK100: '',
        CTX_AREA_NK100: ''
      }
    });
    const rows = pickArray(data.output1 || data.output || data);
    const item = rows.find((row) => String(row.pdno || row.prdt_code || '').trim() === symbol) || {};
    const summary = Array.isArray(data.output2) ? data.output2[0] || {} : data.output2 || {};
    const quantity = num(item.hldg_qty ?? item.qty);
    const averagePrice = num(item.pchs_avg_pric ?? item.avg_prvs);
    const currentPrice = num(item.prpr ?? item.stck_prpr);
    return {
      symbol,
      market: 'KR',
      currency: 'KRW',
      quantity,
      averagePrice,
      evaluationAmount: num(item.evlu_amt) || quantity * currentPrice,
      unrealizedProfit: num(item.evlu_pfls_amt),
      unrealizedProfitRate: normalizeRate(item.evlu_pfls_rt),
      cashAvailable: num(summary.dnca_tot_amt ?? summary.prvs_rcdl_excc_amt),
      source: 'KIS'
    };
  }

  async getOverseasBalance(context, symbol, options = {}) {
    const data = await this.requestJson('/uapi/overseas-stock/v1/trading/inquire-balance', {
      method: 'GET',
      trId: 'TTTS3012R',
      context,
      query: {
        CANO: context.accountNumber,
        ACNT_PRDT_CD: context.accountProductCode,
        OVRS_EXCG_CD: normalizeExchange(options.exchange),
        TR_CRCY_CD: options.currency || 'USD',
        CTX_AREA_FK200: '',
        CTX_AREA_NK200: ''
      }
    });
    const rows = pickArray(data.output1 || data.output || data);
    const item = rows.find((row) => String(row.ovrs_pdno || row.pdno || '').trim().toUpperCase() === symbol.toUpperCase()) || {};
    const summary = Array.isArray(data.output2) ? data.output2[0] || {} : data.output2 || {};
    const quantity = num(item.ovrs_cblc_qty ?? item.hldg_qty ?? item.qty);
    const averagePrice = num(item.pchs_avg_pric ?? item.avg_unpr);
    const currentPrice = num(item.now_pric2 ?? item.ovrs_now_pric1 ?? item.last);
    return {
      symbol,
      market: 'US',
      currency: 'USD',
      quantity,
      averagePrice,
      evaluationAmount: num(item.ovrs_stck_evlu_amt) || quantity * currentPrice,
      unrealizedProfit: num(item.evlu_pfls_amt),
      unrealizedProfitRate: normalizeRate(item.evlu_pfls_rt),
      cashAvailable: num(summary.frcr_buy_psbl_amt1 ?? summary.tot_evlu_pfls_amt),
      source: 'KIS'
    };
  }

  async getDomesticBuyingPower(context, symbol, options = {}) {
    const data = await this.requestJson('/uapi/domestic-stock/v1/trading/inquire-psbl-order', {
      method: 'GET',
      trId: 'TTTC8908R',
      context,
      query: {
        CANO: context.accountNumber,
        ACNT_PRDT_CD: context.accountProductCode,
        PDNO: symbol,
        ORD_UNPR: String(Math.floor(Number(options.price || 0))),
        ORD_DVSN: '00',
        CMA_EVLU_AMT_ICLD_YN: 'N',
        OVRS_ICLD_YN: 'N'
      }
    });
    const row = data.output || data.output1 || data;
    return {
      symbol,
      market: 'KR',
      currency: 'KRW',
      cashAvailable: num(row.ord_psbl_cash ?? row.max_buy_amt ?? row.nrcvb_buy_amt),
      buyableQuantity: num(row.ord_psbl_qty ?? row.max_buy_qty),
      source: 'KIS'
    };
  }

  async getOverseasBuyingPower(context, symbol, options = {}) {
    const data = await this.requestJson('/uapi/overseas-stock/v1/trading/inquire-psamount', {
      method: 'GET',
      trId: 'TTTS3007R',
      context,
      query: {
        CANO: context.accountNumber,
        ACNT_PRDT_CD: context.accountProductCode,
        OVRS_EXCG_CD: normalizeExchange(options.exchange),
        OVRS_ORD_UNPR: String(Number(options.price || 0)),
        ITEM_CD: symbol
      }
    });
    const row = data.output || data.output1 || data;
    // KIS 응답 필드 의미:
    //   frcr_ord_psbl_amt1 / ovrs_ord_psbl_amt : 현재 외화 잔고 기준 매수가능금액 (USD 등).
    //                                            통합증거금 신청 계좌는 KRW가 환산되어 이미 포함됨.
    //   echm_af_ord_psbl_amt / _qty            : "지금 KRW를 환전한다면" 가능한 외화 금액/수량.
    //                                            통합증거금 미신청 계좌에서 KRW 잔고가 얼마나 도움이 될지를 알려준다.
    //   max_ord_psbl_qty                       : 두 자금 원천을 모두 고려한 최대 매수 가능 수량.
    //   exrt                                   : 적용 환율 (외화 1단위당 KRW).
    return {
      symbol,
      market: 'US',
      currency: 'USD',
      cashAvailable: num(row.frcr_ord_psbl_amt1 ?? row.ovrs_ord_psbl_amt ?? row.max_ord_psbl_amt),
      cashAvailableAfterFx: num(row.echm_af_ord_psbl_amt),
      buyableQuantity: num(row.max_ord_psbl_qty ?? row.ovrs_max_ord_psbl_qty),
      buyableQuantityAfterFx: num(row.echm_af_ord_psbl_qty),
      exchangeRate: num(row.exrt),
      source: 'KIS'
    };
  }

  async getDomesticOpenOrders(context, symbol) {
    const data = await this.requestJson('/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl', {
      method: 'GET',
      trId: 'TTTC0084R',
      context,
      query: {
        CANO: context.accountNumber,
        ACNT_PRDT_CD: context.accountProductCode,
        INQR_DVSN_1: '0',
        INQR_DVSN_2: '0',
        CTX_AREA_FK100: '',
        CTX_AREA_NK100: ''
      }
    });
    return pickArray(data.output || data.output1 || data)
      .filter((row) => !symbol || String(row.pdno || '').trim() === symbol)
      .map((row) => normalizeOrderRow(row, 'KR', 'KRW'));
  }

  async getOverseasOpenOrders(context, symbol, options = {}) {
    const data = await this.requestJson('/uapi/overseas-stock/v1/trading/inquire-nccs', {
      method: 'GET',
      trId: 'TTTS3018R',
      context,
      query: {
        CANO: context.accountNumber,
        ACNT_PRDT_CD: context.accountProductCode,
        OVRS_EXCG_CD: normalizeExchange(options.exchange),
        SORT_SQN: 'DS',
        CTX_AREA_FK200: '',
        CTX_AREA_NK200: ''
      }
    });
    return pickArray(data.output || data.output1 || data)
      .filter((row) => !symbol || String(row.pdno || row.ovrs_pdno || '').trim().toUpperCase() === symbol.toUpperCase())
      .map((row) => normalizeOrderRow(row, 'US', 'USD'));
  }

  async getDomesticOrderHistory(context, symbol) {
    const data = await this.requestJson('/uapi/domestic-stock/v1/trading/inquire-daily-ccld', {
      method: 'GET',
      trId: 'TTTC0081R',
      context,
      query: {
        CANO: context.accountNumber,
        ACNT_PRDT_CD: context.accountProductCode,
        INQR_STRT_DT: todayCompact(),
        INQR_END_DT: todayCompact(),
        SLL_BUY_DVSN_CD: '00',
        INQR_DVSN: '00',
        PDNO: symbol,
        CCLD_DVSN: '00',
        ORD_GNO_BRNO: '',
        ODNO: '',
        INQR_DVSN_3: '00',
        INQR_DVSN_1: '',
        CTX_AREA_FK100: '',
        CTX_AREA_NK100: ''
      }
    });
    return pickArray(data.output1 || data.output || data).map((row) => normalizeOrderRow(row, 'KR', 'KRW'));
  }

  async getOverseasOrderHistory(context, symbol, options = {}) {
    const data = await this.requestJson('/uapi/overseas-stock/v1/trading/inquire-ccnl', {
      method: 'GET',
      trId: 'TTTS3035R',
      context,
      query: {
        CANO: context.accountNumber,
        ACNT_PRDT_CD: context.accountProductCode,
        PDNO: symbol,
        ORD_STRT_DT: todayCompact(),
        ORD_END_DT: todayCompact(),
        SLL_BUY_DVSN: '00',
        CCLD_NCCS_DVSN: '00',
        OVRS_EXCG_CD: normalizeExchange(options.exchange),
        SORT_SQN: 'DS',
        ORD_DT: '',
        ORD_GNO_BRNO: '',
        ODNO: '',
        CTX_AREA_FK200: '',
        CTX_AREA_NK200: ''
      }
    });
    return pickArray(data.output || data.output1 || data).map((row) => normalizeOrderRow(row, 'US', 'USD'));
  }

  async placeDomesticOrder(context, order) {
    const body = {
      CANO: context.accountNumber,
      ACNT_PRDT_CD: context.accountProductCode,
      PDNO: order.symbol,
      ORD_DVSN: '00',
      ORD_QTY: String(Math.floor(order.quantity)),
      ORD_UNPR: String(Math.floor(order.orderPrice))
    };
    return this.requestOrder('/uapi/domestic-stock/v1/trading/order-cash', {
      trId: order.side === 'BUY' ? 'TTTC0012U' : 'TTTC0011U',
      context,
      body,
      order
    });
  }

  async placeOverseasOrder(context, order) {
    const body = {
      CANO: context.accountNumber,
      ACNT_PRDT_CD: context.accountProductCode,
      OVRS_EXCG_CD: normalizeExchange(order.exchange),
      PDNO: order.symbol,
      ORD_DVSN: '00',
      ORD_QTY: String(order.quantity),
      OVRS_ORD_UNPR: String(order.orderPrice),
      ORD_SVR_DVSN_CD: '0'
    };
    return this.requestOrder('/uapi/overseas-stock/v1/trading/order', {
      trId: order.side === 'BUY' ? 'TTTT1002U' : 'TTTT1006U',
      context,
      body,
      order
    });
  }

  async requestOrder(path, { trId, context, body, order }) {
    const data = await this.requestJson(path, {
      method: 'POST',
      trId,
      context,
      body
    });
    const row = data.output || data.output1 || data;
    return {
      status: 'ACCEPTED',
      orderNo: String(row.ODNO ?? row.odno ?? row.order_no ?? '').trim() || null,
      originalOrderNo: String(row.KRX_FWDG_ORD_ORGNO ?? row.ord_orgno ?? '').trim() || null,
      requestPayloadMasked: maskPayload(body),
      responsePayloadMasked: maskPayload(data)
    };
  }

  async requireAccountContext() {
    const context = await getAuthContext(this.userId);
    if (!context.accountNumber || !context.accountProductCode) {
      const error = new Error('KIS 계좌번호와 계좌 상품코드를 먼저 저장하세요.');
      error.status = 400;
      throw error;
    }
    return context;
  }

  async requestJson(path, options) {
    // KIS는 초당 거래건수 제한(EGW00201)이 있다. 우리 측에서:
    //   1) 직전 호출과 최소 간격(MIN_INTERVAL_MS)을 두어 같은 초에 호출이 몰리지 않게 한다.
    //   2) rate-limit / 5xx 같은 일시 오류는 짧은 backoff로 재시도한다 (주문은 멱등성 때문에 재시도 안 함).
    return runRateLimited(this.userId, () => this.requestJsonOnce(path, options));
  }

  async requestJsonOnce(path, { method, trId, context, query = null, body = null }, attempt = 0) {
    const url = new URL(`${context.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value ?? '');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.kisTimeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          authorization: `Bearer ${context.accessToken}`,
          appkey: context.appKey,
          appsecret: context.appSecret,
          tr_id: trId
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || isFailureResponse(data)) {
        const baseMsg = method === 'POST' ? ORDER_ERROR : MARKET_ERROR;
        const detail = describeKisError(data, response.status);
        const transient = isTransientFailure(data, response.status);
        // 조회 API에 한해 EGW00201 / 5xx / 429를 backoff 후 재시도. 주문 API(POST)는 위험하므로 절대 재시도 안 함.
        if (method !== 'POST' && transient && attempt < KIS_RETRY_BACKOFF_MS.length) {
          clearTimeout(timeout);
          await sleep(KIS_RETRY_BACKOFF_MS[attempt]);
          return this.requestJsonOnce(path, { method, trId, context, query, body }, attempt + 1);
        }
        const error = new Error(detail ? `${baseMsg} (${detail})` : baseMsg);
        error.status = response.status >= 400 ? response.status : 502;
        error.safePayload = maskPayload(data);
        throw error;
      }
      return data;
    } catch (error) {
      if (error.status) throw error;
      const wrapped = new Error(method === 'POST' ? ORDER_ERROR : MARKET_ERROR);
      wrapped.status = error.name === 'AbortError' ? 504 : 502;
      throw wrapped;
    } finally {
      clearTimeout(timeout);
    }
  }
}

const KIS_RETRY_BACKOFF_MS = [400, 900, 1800];
const KIS_MIN_INTERVAL_MS = 220; // 안전 마진 — 일반 KIS 계정 5건/초 한도 아래로 유지.
const rateLimitQueue = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 사용자별로 KIS 호출 사이에 최소 간격을 보장한다.
async function runRateLimited(userId, work) {
  const key = userId || 'anon';
  const prev = rateLimitQueue.get(key) || Promise.resolve(0);
  const next = prev.then(async () => {
    const now = Date.now();
    const lastEnd = await prev;
    const gap = now - (lastEnd || 0);
    if (gap < KIS_MIN_INTERVAL_MS) await sleep(KIS_MIN_INTERVAL_MS - gap);
    try {
      return await work();
    } finally {
      // chained Promise 가 다음 호출의 시작 시점을 알도록 끝 시각을 흘려보낸다.
    }
  });
  // 다음 호출이 기다릴 종료 시각을 별도 promise 로 연결.
  const tail = next.then(() => Date.now(), () => Date.now());
  rateLimitQueue.set(key, tail);
  return next;
}

function isTransientFailure(data, status) {
  const code = String(data?.msg_cd ?? data?.rt_cd ?? '').trim();
  if (code === 'EGW00201') return true; // 초당 거래건수 초과
  if (code.startsWith('EGW')) return true; // KIS 게이트웨이 일시 오류 군
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

// KIS 응답의 안전한 부분(rt_cd / msg_cd / msg1)을 사용자에게 보여줄 한 줄로 추린다.
// 비밀로 다뤄야 할 access_token, account_number 등은 응답 body의 다른 자리에 있다.
function describeKisError(data, httpStatus) {
  if (!data || typeof data !== 'object') return httpStatus ? `HTTP ${httpStatus}` : '';
  const code = String(data.msg_cd ?? data.rt_cd ?? '').trim();
  const message = String(data.msg1 ?? data.message ?? data.return_msg ?? '').trim();
  if (code && message) return `${code} ${message}`;
  if (message) return message;
  if (code) return `code=${code}`;
  if (httpStatus) return `HTTP ${httpStatus}`;
  return '';
}

export function maskPayload(payload) {
  if (!payload) return null;
  return JSON.stringify(maskValue(payload));
}

function maskValue(value) {
  if (Array.isArray(value)) return value.map(maskValue);
  if (!value || typeof value !== 'object') return value;
  const masked = {};
  for (const [key, val] of Object.entries(value)) {
    if (/appsecret|appkey|authorization|token|cano|acnt|account/i.test(key)) {
      masked[key] = '[MASKED]';
    } else {
      masked[key] = maskValue(val);
    }
  }
  return masked;
}

function normalizeOrderRow(row, market, currency) {
  const orderedQuantity = num(row.ord_qty ?? row.ft_ord_qty ?? row.ovrs_ord_qty);
  const filledQuantity = num(row.tot_ccld_qty ?? row.ft_ccld_qty ?? row.ccld_qty);
  const remainingQuantity = num(row.nccs_qty ?? row.ft_nccs_qty ?? row.rmnd_qty);
  const orderNo = String(row.odno ?? row.ODNO ?? '').trim() || null;
  const status = remainingQuantity > 0
    ? (filledQuantity > 0 ? 'PARTIALLY_FILLED' : 'ACCEPTED')
    : (filledQuantity > 0 || orderedQuantity > 0 ? 'FILLED' : 'UNKNOWN');
  return {
    orderNo,
    originalOrderNo: String(row.orgn_odno ?? row.KRX_FWDG_ORD_ORGNO ?? '').trim() || null,
    symbol: String(row.pdno ?? row.ovrs_pdno ?? '').trim(),
    market,
    currency,
    side: normalizeSide(row.sll_buy_dvsn_cd_name ?? row.sll_buy_dvsn_cd ?? row.sll_buy_dvsn),
    status,
    filledQuantity,
    remainingQuantity,
    averageFilledPrice: num(row.avg_prvs ?? row.ft_ccld_unpr3 ?? row.ccld_unpr),
    responsePayloadMasked: maskPayload(row)
  };
}

function normalizeSide(value) {
  const text = String(value || '').toUpperCase();
  if (text.includes('SELL') || text.includes('매도') || text === '01') return 'SELL';
  return 'BUY';
}

function isFailureResponse(data) {
  const rtCd = data?.rt_cd ?? data?.rtCd;
  return rtCd != null && String(rtCd) !== '0';
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) return child;
    }
  }
  return [];
}

function normalizeMarket(value, symbol) {
  const market = String(value || '').trim().toUpperCase();
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') return 'KR';
  if (market === 'US') return 'US';
  return /^\d{6}$/.test(String(symbol || '')) ? 'KR' : 'US';
}

function normalizeExchange(value) {
  return String(value || 'NAS').trim().toUpperCase();
}

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function normalizeRate(value) {
  const n = num(value);
  return n > 1 ? n / 100 : n;
}

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}
