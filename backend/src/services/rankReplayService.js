import * as krRepo from '../repositories/krRankRepository.js';
import * as usRepo from '../repositories/usRankRepository.js';
import {
  getDomesticHistoricalMinuteCandles,
  getOverseasHistoricalMinuteCandles
} from './marketDataService.js';
import { evaluateFastStopLoss } from './krRankStrategyEngine.js';

const DEFAULT_TARGETS = [0.02, 0.03, 0.05];
const DEFAULT_STOPS = [0.03, 0.04, 0.05];
const MAX_HISTORY_SCAN = 500;

export async function replayKrRankTrade(userId, strategyId, buyOrderId, options = {}) {
  const row = krRepo.listRoundTripOrders(userId, { strategyId, limit: MAX_HISTORY_SCAN, offset: 0 })
    .find((item) => Number(item.buyOrderId) === Number(buyOrderId));
  if (!row) throw notFound('복기할 한국장 거래를 찾을 수 없습니다.');
  if (!row.buyPrice) throw badRequest('매수 체결가가 확인된 거래만 복기할 수 있습니다.');
  const date = localDate(row.buyTime, 'Asia/Seoul');
  const buyHms = localTime(row.buyTime, 'Asia/Seoul');
  const candles = await getDomesticHistoricalMinuteCandles(userId, row.symbol, {
    date,
    // KIS 분봉은 기준 시각에서 과거로 ~120봉만 돌려준다. 종가(153000) 고정이면 오전·점심
    // 거래가 창 밖으로 빠지므로, 매수 시각 기준으로 잡는다. +100분이면 매수 직전 ~20봉(빠른 손절
    // 직전 분봉 창 확보)과 보유 구간·매도 직후가 함께 담긴다.
    hour: shiftHms(buyHms, 100)
  });
  return buildReplayResult({
    market: 'KR',
    currency: 'KRW',
    row,
    candles,
    buyTime: buyHms,
    sellTime: row.sellTime ? localTime(row.sellTime, 'Asia/Seoul') : null,
    targetRates: parseRateList(options.targetRates, DEFAULT_TARGETS),
    stopRates: parseRateList(options.stopRates, DEFAULT_STOPS)
  });
}

export async function replayUsRankTrade(userId, strategyId, tradeId, options = {}) {
  const row = usRepo.listRoundTripOrders(userId, { strategyId, limit: MAX_HISTORY_SCAN, offset: 0 })
    .find((item) => Number(item.tradeId) === Number(tradeId));
  if (!row) throw notFound('복기할 미국장 거래를 찾을 수 없습니다.');
  if (!row.buyPrice) throw badRequest('매수 체결가가 확인된 거래만 복기할 수 있습니다.');
  const date = localDate(row.buyTime, 'America/New_York');
  const buyHms = localTime(row.buyTime, 'America/New_York');
  const candles = await getOverseasHistoricalMinuteCandles(userId, row.symbol, row.exchange || 'NAS', {
    date,
    // 종가(160000) 고정이면 장중 매수 거래가 ~120봉 창 밖으로 빠진다. 매수 시각 기준으로 잡아
    // 매수 직전 ~20봉과 보유 구간·매도 직후가 함께 담기게 한다.
    hour: shiftHms(buyHms, 100),
    count: 120
  });
  return buildReplayResult({
    market: 'US',
    currency: 'USD',
    row,
    candles,
    buyTime: buyHms,
    sellTime: row.sellTime ? localTime(row.sellTime, 'America/New_York') : null,
    targetRates: parseRateList(options.targetRates, DEFAULT_TARGETS),
    stopRates: parseRateList(options.stopRates, DEFAULT_STOPS)
  });
}

function buildReplayResult({ market, currency, row, candles, buyTime, sellTime, targetRates, stopRates }) {
  const buyPrice = Number(row.buyPrice);
  const afterBuy = candles.filter((c) => c.time >= buyTime);
  if (afterBuy.length === 0) {
    throw badRequest('매수 시각 이후 분봉 데이터가 없어 복기할 수 없습니다.');
  }
  const holdCandles = sellTime ? afterBuy.filter((c) => c.time <= sellTime) : afterBuy;
  const replayCandles = holdCandles.length > 0 ? holdCandles : afterBuy;
  const mfeHigh = replayCandles.reduce((max, c) => Math.max(max, Number(c.high || 0)), 0);
  const maeLow = replayCandles.reduce((min, c) => Math.min(min, Number(c.low || Infinity)), Infinity);
  const targetHits = targetRates.map((rate) => firstHit(replayCandles, buyPrice, rate, 'TARGET'));
  const stopHits = stopRates.map((rate) => firstHit(replayCandles, buyPrice, rate, 'STOP'));
  const entryFailure = firstFastStopLoss(candles, buyTime, sellTime, buyPrice, market);
  const ambiguity = findAmbiguity(replayCandles, buyPrice, targetRates, stopRates);
  return {
    market,
    currency,
    symbol: row.symbol,
    symbolName: row.symbolName,
    buyTime: row.buyTime,
    buyPrice,
    sellTime: row.sellTime,
    sellPrice: row.sellPrice,
    sellReason: row.sellReason,
    actualProfitRate: row.profitRate,
    candleCount: replayCandles.length,
    mfeRate: Number.isFinite(mfeHigh) && mfeHigh > 0 ? (mfeHigh - buyPrice) / buyPrice : null,
    maeRate: Number.isFinite(maeLow) && maeLow < Infinity ? (maeLow - buyPrice) / buyPrice : null,
    targetHits,
    stopHits,
    entryFailure,
    ambiguity,
    note: '거래 복기는 실제 거래 한 건의 분봉 흐름을 되짚는 분석입니다. 과거 랭킹 전체를 재현하는 백테스트가 아닙니다.'
  };
}

function firstHit(candles, buyPrice, rate, type) {
  const threshold = type === 'TARGET'
    ? buyPrice * (1 + rate)
    : buyPrice * (1 - rate);
  const candle = candles.find((c) => (
    type === 'TARGET'
      ? Number(c.high || 0) >= threshold
      : Number(c.low || Infinity) <= threshold
  ));
  return {
    type,
    rate,
    threshold,
    hit: Boolean(candle),
    time: candle?.time || null
  };
}

// 라이브 빠른 손절 판정은 KIS 당일분봉(FHKST03010200, 최대 ~30봉)을 보므로,
// 복기도 같은 길이의 직전 분봉 창으로 평가해야 라이브와 어긋나지 않는다. 매수 시각 이후(보유
// 구간)의 각 봉에서, 매수 직전 봉까지 포함한 직전 LIVE_FLOW_WINDOW 봉으로 빠른 손절을 판단한다.
const LIVE_FLOW_WINDOW = 30;

function firstFastStopLoss(candles, buyTime, sellTime, buyPrice, market) {
  for (let i = 0; i < candles.length; i += 1) {
    const time = candles[i].time;
    if (time < buyTime) continue;
    if (sellTime && time > sellTime) break;
    const window = candles.slice(Math.max(0, i - (LIVE_FLOW_WINDOW - 1)), i + 1);
    if (window.length < 3) continue;
    const close = Number(candles[i]?.close || 0);
    const profitRate = buyPrice > 0 && close > 0 ? (close - buyPrice) / buyPrice : 0;
    const result = evaluateFastStopLoss(window, market === 'US'
      ? { profitRate, minLossRate: 0.03, highPullbackRate: 0.04, openBreakRate: 0.01 }
      : { profitRate });
    if (result.failed) {
      return { hit: true, time, reason: result.reason };
    }
  }
  return { hit: false, time: null, reason: null };
}

function findAmbiguity(candles, buyPrice, targetRates, stopRates) {
  const out = [];
  for (const candle of candles) {
    for (const targetRate of targetRates) {
      const target = buyPrice * (1 + targetRate);
      if (Number(candle.high || 0) < target) continue;
      for (const stopRate of stopRates) {
        const stop = buyPrice * (1 - stopRate);
        if (Number(candle.low || Infinity) <= stop) {
          out.push({
            time: candle.time,
            targetRate,
            stopRate,
            reason: '1분봉 안에서 목표가와 손절가가 모두 닿아 선후 관계를 확정할 수 없습니다.'
          });
        }
      }
    }
  }
  return out;
}

function parseRateList(value, fallback) {
  if (!value) return fallback;
  const arr = Array.isArray(value) ? value : String(value).split(',');
  const parsed = arr.map((item) => Number(item)).filter((n) => Number.isFinite(n) && n > 0 && n < 1);
  return parsed.length > 0 ? parsed.slice(0, 5) : fallback;
}

function localDate(value, timeZone) {
  const parts = dateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTime(value, timeZone) {
  const parts = dateParts(value, timeZone);
  return `${parts.hour}${parts.minute}${parts.second}`;
}

// 'HHMMSS'에 분을 더해 같은 형식으로 돌려준다. 하루 끝(23:59)을 넘기면 그 값으로 고정한다.
function shiftHms(hms, addMinutes) {
  const text = String(hms || '').padStart(6, '0');
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));
  const seconds = text.slice(4, 6);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return text;
  const total = Math.min(hours * 60 + minutes + addMinutes, 23 * 60 + 59);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}${mm}${seconds}`;
}

function dateParts(value, timeZone) {
  const raw = String(value || '').trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const date = normalized ? new Date(normalized) : new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const out = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  if (out.hour === '24') out.hour = '00';
  return out;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}
