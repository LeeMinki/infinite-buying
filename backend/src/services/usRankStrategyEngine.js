// 미국 국장 상승률 랭킹 전략(US_RANK_MOMENTUM)의 순수 판단 로직.
// KIS 호출·DB 기록은 usRankService 가 담당하고, 여기서는 시간 판정과 매수/매도 판단만 한다.

export const MAX_FLUCTUATION_RATE = 0.20;
export const DEFAULT_TARGET_PROFIT_RATE = 0.02;
export const DEFAULT_STOP_LOSS_RATE = 0.05;
export const DEFAULT_FORCE_CLOSE_KST = '04:30';

const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const KST_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

export function isUsRegularSession(now = new Date()) {
  const et = timeParts(now, ET_FORMATTER);
  const day = new Date(Date.UTC(et.year, et.month - 1, et.day)).getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.hour * 60 + et.minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function isUsForceCloseTime(now = new Date(), forceCloseKst = DEFAULT_FORCE_CLOSE_KST) {
  if (!isUsRegularSession(now)) return false;
  const forceMinutes = parseHhmmMinutes(forceCloseKst);
  if (forceMinutes == null) return false;
  const minutes = kstNowMinutes(now);
  // 미국장은 KST 저녁에 열려 다음날 새벽에 끝난다. 22~23시대가 04:30보다 크다고
  // 즉시 청산되면 안 되므로 새벽 구간만 강제 청산 대상으로 본다.
  return minutes < 12 * 60 && minutes >= forceMinutes;
}

export function etTradeDate(now = new Date()) {
  const et = timeParts(now, ET_FORMATTER);
  return `${et.year}-${String(et.month).padStart(2, '0')}-${String(et.day).padStart(2, '0')}`;
}

export function kstNowMinutes(now = new Date()) {
  const kst = timeParts(now, KST_FORMATTER);
  return kst.hour * 60 + kst.minute;
}

export function parseHhmmMinutes(value) {
  if (value == null) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function selectRankingCandidate(rankingList = [], { maxFluctuationRate = MAX_FLUCTUATION_RATE } = {}) {
  if (!Array.isArray(rankingList)) return null;
  for (const item of rankingList) {
    if (!item || !item.symbol) continue;
    const rate = Number(item.fluctuationRate);
    if (!Number.isFinite(rate)) continue;
    if (rate >= Number(maxFluctuationRate)) continue;
    const price = Number(item.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    return {
      symbol: String(item.symbol).trim().toUpperCase(),
      name: item.name || item.symbol,
      exchange: item.exchange || 'NAS',
      price,
      fluctuationRate: rate
    };
  }
  return null;
}

export function computeBuyQuantity(cashAvailable, price) {
  const cash = Number(cashAvailable);
  const unit = Number(price);
  if (!Number.isFinite(cash) || !Number.isFinite(unit) || cash <= 0 || unit <= 0) return 0;
  return Math.floor(cash / unit);
}

export function evaluateSell({
  currentPrice,
  averagePrice,
  targetProfitRate = DEFAULT_TARGET_PROFIT_RATE,
  stopLossRate = DEFAULT_STOP_LOSS_RATE,
  forceCloseTriggered = false
} = {}) {
  const price = Number(currentPrice);
  const avg = Number(averagePrice);
  if (!Number.isFinite(price) || !Number.isFinite(avg) || price <= 0 || avg <= 0) {
    return { decision: 'HOLD', sellReason: null, profitRate: 0 };
  }
  const profitRate = (price - avg) / avg;
  if (profitRate >= Number(targetProfitRate)) {
    return { decision: 'SELL', sellReason: 'TARGET', profitRate };
  }
  if (profitRate <= -Number(stopLossRate)) {
    return { decision: 'SELL', sellReason: 'STOP_LOSS', profitRate };
  }
  if (forceCloseTriggered) {
    return { decision: 'SELL', sellReason: 'FORCE_CLOSE', profitRate };
  }
  return { decision: 'HOLD', sellReason: null, profitRate };
}

export function makeUsRankIdempotencyKey({ tradeDate, strategyId, tradeSeq, side }) {
  return [
    String(tradeDate || '').replaceAll('-', ''),
    strategyId,
    tradeSeq,
    String(side || '').toUpperCase()
  ].join('-');
}

function timeParts(date, formatter) {
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  if (parts.hour === 24) parts.hour = 0;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute
  };
}
