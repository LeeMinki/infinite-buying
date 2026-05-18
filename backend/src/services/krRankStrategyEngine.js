// 한국 국장 상승률 랭킹 전략(KR_RANK_MOMENTUM)의 순수 판단 로직.
// KIS 호출·DB는 krRankService 가 담당하고, 여기서는 입력값만으로 결정한다.

// 진입 시 등락률이 이 값 이상인 종목은 매수 대상에서 제외한다(가격제한폭 근접 종목 회피).
export const MAX_FLUCTUATION_RATE = 0.3;

// 진입 구간. 스케줄러 tick 간격(기본 10분)보다 넉넉히 잡아 한 구간을 반드시 한 번은 포착한다.
export const ENTRY_WINDOWS = {
  MORNING: { label: '오전', startMinutes: 9 * 60 + 10, endMinutes: 10 * 60 },
  LUNCH: { label: '점심', startMinutes: 11 * 60 + 30, endMinutes: 12 * 60 + 20 }
};

// 현재 시각(KST)이 어느 진입 구간에 속하는지 판정한다. 구간 밖이면 null.
// 점심 진입은 lunchEntryEnabled 가 켜져 있을 때만 반환한다.
export function resolveEntryWindow(now = new Date(), { lunchEntryEnabled = false } = {}) {
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return null; // 주말 휴장
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  const inWindow = (w) => minutes >= w.startMinutes && minutes < w.endMinutes;
  if (inWindow(ENTRY_WINDOWS.MORNING)) return 'MORNING';
  if (lunchEntryEnabled && inWindow(ENTRY_WINDOWS.LUNCH)) return 'LUNCH';
  return null;
}

// 등락률 상위 랭킹에서 등락률 30% 이상 종목을 제외하고 남은 첫 종목을 고른다.
// 후보가 없으면 null.
export function selectRankingCandidate(rankingList = [], { maxFluctuationRate = MAX_FLUCTUATION_RATE } = {}) {
  if (!Array.isArray(rankingList)) return null;
  for (const item of rankingList) {
    if (!item || !item.symbol) continue;
    const rate = Number(item.fluctuationRate);
    if (!Number.isFinite(rate)) continue;
    if (rate >= maxFluctuationRate) continue;
    const price = Number(item.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    return {
      symbol: item.symbol,
      name: item.name || item.symbol,
      price,
      fluctuationRate: rate
    };
  }
  return null;
}

// 가용 현금을 최대한 사용한 정수 매수 수량. 1주 값에 못 미치면 0.
export function computeBuyQuantity(cashAvailable, price) {
  const cash = Number(cashAvailable);
  const unit = Number(price);
  if (!Number.isFinite(cash) || !Number.isFinite(unit) || cash <= 0 || unit <= 0) return 0;
  return Math.floor(cash / unit);
}

// 보유 종목의 매도 판단. 목표 수익률 도달 → TARGET, 손절 기준 도달 → STOP_LOSS, 그 외 HOLD.
export function evaluateSell({ currentPrice, averagePrice, targetProfitRate, stopLossRate }) {
  const price = Number(currentPrice);
  const avg = Number(averagePrice);
  if (!Number.isFinite(price) || !Number.isFinite(avg) || avg <= 0 || price <= 0) {
    return { decision: 'HOLD', sellReason: null, profitRate: 0 };
  }
  const profitRate = (price - avg) / avg;
  if (profitRate >= Number(targetProfitRate)) {
    return { decision: 'SELL', sellReason: 'TARGET', profitRate };
  }
  if (profitRate <= -Number(stopLossRate)) {
    return { decision: 'SELL', sellReason: 'STOP_LOSS', profitRate };
  }
  return { decision: 'HOLD', sellReason: null, profitRate };
}

// 멱등키: {YYYYMMDD}-{strategyId}-{window}-{side}. 같은 (날짜·전략·구간·방향) 중복 주문을 막는다.
export function makeKrRankIdempotencyKey({ tradeDate, strategyId, entryWindow, side }) {
  return [
    String(tradeDate || '').replaceAll('-', ''),
    strategyId,
    entryWindow,
    side
  ].join('-');
}
