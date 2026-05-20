// 미국 상승률 랭킹 전략(US_RANK_MOMENTUM)의 순수 판단 로직.
// KIS 호출·DB 기록은 usRankService 가 담당하고, 여기서는 시간 판정과 매수/매도 판단만 한다.

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

// 미국장은 한국처럼 가격제한폭(상한가)이 없어 등락률 상한 필터를 두지 않는다.
// 가장 상승률 높은 종목부터 검사해 유효한 첫 종목을 반환한다.
export function selectRankingCandidate(rankingList = []) {
  if (!Array.isArray(rankingList)) return null;
  for (const item of rankingList) {
    if (!item || !item.symbol) continue;
    const rate = Number(item.fluctuationRate);
    if (!Number.isFinite(rate)) continue;
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

// 누적 평가 자산 = 현금(USD 매수가능금액) + 보유 평가액. baseline 대비 변화율로 사이클 목표 달성 여부를 본다.
export function computeCycleProfitRate({ baselineUsd, cashAvailable, holdingQuantity, currentPrice }) {
  const baseline = Number(baselineUsd);
  if (!Number.isFinite(baseline) || baseline <= 0) return null;
  const cash = Number(cashAvailable || 0);
  const qty = Number(holdingQuantity || 0);
  const price = Number(currentPrice || 0);
  const totalAsset = cash + Math.max(0, qty) * Math.max(0, price);
  return (totalAsset - baseline) / baseline;
}

export function computeBuyQuantity(cashAvailable, price) {
  const cash = Number(cashAvailable);
  const unit = Number(price);
  if (!Number.isFinite(cash) || !Number.isFinite(unit) || cash <= 0 || unit <= 0) return 0;
  return Math.floor(cash / unit);
}

// 우선순위: 사이클 목표 달성(CYCLE_COMPLETE) > 손절(STOP_LOSS) > 익절(TARGET) > 강제 청산(FORCE_CLOSE).
//  - 사이클 완료가 1순위 — 영구 정지 트리거이므로 다른 조건보다 먼저 잡아 종료한다.
//  - 손절은 익절보다 먼저 — 손실 보호가 항상 우선.
//  - 강제 청산은 시간 도달인 만큼 익절·손절이 자연 발생하면 그쪽 사유로 기록.
export function evaluateSell({
  currentPrice,
  averagePrice,
  targetProfitRate = DEFAULT_TARGET_PROFIT_RATE,
  stopLossRate = DEFAULT_STOP_LOSS_RATE,
  forceCloseTriggered = false,
  cycleTargetReached = false
} = {}) {
  const price = Number(currentPrice);
  const avg = Number(averagePrice);
  if (!Number.isFinite(price) || !Number.isFinite(avg) || price <= 0 || avg <= 0) {
    return { decision: 'HOLD', sellReason: null, profitRate: 0 };
  }
  const profitRate = (price - avg) / avg;
  if (cycleTargetReached) {
    return { decision: 'SELL', sellReason: 'CYCLE_COMPLETE', profitRate };
  }
  if (profitRate <= -Number(stopLossRate)) {
    return { decision: 'SELL', sellReason: 'STOP_LOSS', profitRate };
  }
  if (profitRate >= Number(targetProfitRate)) {
    return { decision: 'SELL', sellReason: 'TARGET', profitRate };
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
