// 한국 국장 상승률 랭킹 전략(KR_RANK_MOMENTUM)의 순수 판단 로직.
// KIS 호출·DB는 krRankService 가 담당하고, 여기서는 입력값만으로 결정한다.

// 진입 시 등락률이 이 값 이상인 종목은 매수 대상에서 제외한다.
// 20% — 상한가(+30%)까지 헤드룸을 충분히 남겨 목표 수익 도달 여지를 확보한다.
export const MAX_FLUCTUATION_RATE = 0.20;

// 매수 필터 기본값 — 단기 흐름 검사용. krRankBuyFilter 절을 참고.
export const BUY_FILTER_DEFAULTS = {
  // 최근 거래량 추세 판정용. 직전 N봉 합 / 그 이전 N봉 합 비율이 이 값 미만이면 감소 추세로 본다.
  volumeShrinkRatio: 0.5,
  // 장대 음봉 판정 — 몸통(시가-종가)이 시가 대비 이 비율 이상이고 거래량이 최근 평균 대비 이 배수 이상이면 거절.
  bearishBodyMinRate: 0.005,
  bearishVolumeMultiplier: 1.2,
  // 단기 고점 돌파 실패 — 마지막 종가가 최근 N봉(마지막 제외) 최고가의 이 비율 미만이면 거절.
  highBreakoutTolerance: 0.99,
  // 필터에 쓸 최근 분봉 수. 30분이면 9:10 평가 시점에 9봉(09:01~09:09)만 들어와 부족할 수 있어
  // 최소 봉 수도 함께 둔다.
  minimumCandles: 3,
  trendWindow: 3,
  bearishWindow: 10,
  breakoutWindow: 10
};

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

// 등락률 상위 랭킹에서 등락률 상한 이상 종목을 제외하고 남은 첫 종목을 고른다.
// 후보가 없으면 null.
export function selectRankingCandidate(rankingList = [], options = {}) {
  return selectRankingCandidates(rankingList, options)[0] || null;
}

// 같은 필터를 적용해 후보 목록을 그대로 돌려준다. 매수 필터(분봉 검사)는
// 첫 후보가 떨어졌을 때 차순위로 넘기기 위해 호출 측이 직접 순회한다.
export function selectRankingCandidates(rankingList = [], { maxFluctuationRate = MAX_FLUCTUATION_RATE } = {}) {
  if (!Array.isArray(rankingList)) return [];
  const out = [];
  for (const item of rankingList) {
    if (!item || !item.symbol) continue;
    const rate = Number(item.fluctuationRate);
    if (!Number.isFinite(rate)) continue;
    if (rate >= maxFluctuationRate) continue;
    const price = Number(item.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      symbol: item.symbol,
      name: item.name || item.symbol,
      price,
      fluctuationRate: rate
    });
  }
  return out;
}

// ── 단기 흐름 매수 필터 ───────────────────────────────────────────────
//
// 등락률 랭킹 상위라 해서 무조건 매수하지 않는다. 9시 10분 진입 직전까지의 분봉으로
// 다음 다섯 가지를 본다:
//   1) 현재가가 시가보다 위에 있는가
//   2) 현재가가 VWAP(누적 거래량가중 평균가)보다 위에 있는가
//   3) 직전 N봉 거래량 합이 그 이전 N봉 거래량 합보다 너무 줄지 않았는가(거래량 유지)
//   4) 최근 N봉 중 거래량을 동반한 장대 음봉이 있는가(있으면 거절)
//   5) 직전 N봉 최고가 대비 현재가가 너무 밀려 있는가(고점 미돌파)
// 다섯 모두 통과해야 매수 후보로 본다. 분봉이 부족하면 보수적으로 거절한다.

export function computeVwap(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return 0;
  let pv = 0;
  let v = 0;
  for (const c of candles) {
    const high = Number(c?.high) || 0;
    const low = Number(c?.low) || 0;
    const close = Number(c?.close) || 0;
    const volume = Math.max(0, Number(c?.volume) || 0);
    if (volume <= 0) continue;
    const typical = (high + low + close) / 3;
    if (!Number.isFinite(typical) || typical <= 0) continue;
    pv += typical * volume;
    v += volume;
  }
  return v > 0 ? pv / v : 0;
}

export function isVolumeDecreasing(candles, window = BUY_FILTER_DEFAULTS.trendWindow, shrinkRatio = BUY_FILTER_DEFAULTS.volumeShrinkRatio) {
  if (!Array.isArray(candles) || candles.length < window * 2) return false;
  const tail = candles.slice(-window).reduce((s, c) => s + (Number(c?.volume) || 0), 0);
  const prior = candles.slice(-window * 2, -window).reduce((s, c) => s + (Number(c?.volume) || 0), 0);
  if (prior <= 0) return false;
  return tail / prior < shrinkRatio;
}

export function findLargeBearishCandle(candles, opts = {}) {
  const window = opts.window ?? BUY_FILTER_DEFAULTS.bearishWindow;
  const bodyMin = opts.bodyMinRate ?? BUY_FILTER_DEFAULTS.bearishBodyMinRate;
  const volMul = opts.volumeMultiplier ?? BUY_FILTER_DEFAULTS.bearishVolumeMultiplier;
  if (!Array.isArray(candles) || candles.length < 2) return null;
  const recent = candles.slice(-window);
  const avgVolume = recent.reduce((s, c) => s + (Number(c?.volume) || 0), 0) / recent.length;
  for (const c of recent) {
    const open = Number(c?.open) || 0;
    const close = Number(c?.close) || 0;
    const volume = Number(c?.volume) || 0;
    if (open <= 0 || close <= 0 || volume <= 0) continue;
    if (close >= open) continue; // 음봉만
    const bodyRate = (open - close) / open;
    if (bodyRate >= bodyMin && volume >= avgVolume * volMul) {
      return { time: c.time, open, close, volume, bodyRate };
    }
  }
  return null;
}

export function isFailingHighBreakout(candles, opts = {}) {
  const window = opts.window ?? BUY_FILTER_DEFAULTS.breakoutWindow;
  const tolerance = opts.tolerance ?? BUY_FILTER_DEFAULTS.highBreakoutTolerance;
  if (!Array.isArray(candles) || candles.length < 3) return false;
  const last = candles[candles.length - 1];
  const priorSlice = candles.slice(-Math.min(window + 1, candles.length), -1);
  if (priorSlice.length === 0) return false;
  const recentHigh = Math.max(...priorSlice.map((c) => Number(c?.high) || 0));
  const close = Number(last?.close) || 0;
  if (close <= 0 || recentHigh <= 0) return false;
  return close < recentHigh * tolerance;
}

// 매수 필터의 통합 진입점. ok=true면 매수 후보로 통과, false면 reason에 거절 사유.
export function checkBuyCandidate(candles, opts = {}) {
  const minCandles = opts.minimumCandles ?? BUY_FILTER_DEFAULTS.minimumCandles;
  if (!Array.isArray(candles) || candles.length < minCandles) {
    return { ok: false, reason: '분봉 데이터가 부족해 단기 흐름을 확인할 수 없습니다.' };
  }
  const last = candles[candles.length - 1];
  const opening = Number(candles[0]?.open) || 0;
  const current = Number(last?.close) || 0;
  if (opening <= 0 || current <= 0) {
    return { ok: false, reason: '분봉 시가/현재가가 비어 있어 단기 흐름을 확인할 수 없습니다.' };
  }

  if (current <= opening) {
    return { ok: false, reason: `현재가 ${fmtPrice(current)}원이 시가 ${fmtPrice(opening)}원 아래라 매수하지 않습니다.` };
  }

  const vwap = computeVwap(candles);
  if (vwap > 0 && current <= vwap) {
    return { ok: false, reason: `현재가 ${fmtPrice(current)}원이 VWAP ${fmtPrice(vwap)}원 아래라 매수하지 않습니다.` };
  }

  if (isVolumeDecreasing(candles, opts.trendWindow, opts.volumeShrinkRatio)) {
    return { ok: false, reason: '최근 거래량이 직전 구간보다 크게 줄어 매수하지 않습니다.' };
  }

  const bearish = findLargeBearishCandle(candles, opts);
  if (bearish) {
    return { ok: false, reason: '거래량을 동반한 장대 음봉이 발생해 매수하지 않습니다.' };
  }

  if (isFailingHighBreakout(candles, opts)) {
    return { ok: false, reason: '직전 고점을 돌파하지 못하고 밀려 매수하지 않습니다.' };
  }

  return { ok: true, reason: null };
}

function fmtPrice(value) {
  return Math.round(Number(value) || 0).toLocaleString('ko-KR');
}

// 가용 현금을 최대한 사용한 정수 매수 수량. 1주 값에 못 미치면 0.
export function computeBuyQuantity(cashAvailable, price) {
  const cash = Number(cashAvailable);
  const unit = Number(price);
  if (!Number.isFinite(cash) || !Number.isFinite(unit) || cash <= 0 || unit <= 0) return 0;
  return Math.floor(cash / unit);
}

// 보유 종목의 매도 판단.
// 우선순위: 목표 수익률(TARGET) → 손절 기준(STOP_LOSS) → 시각 청산(TIME_LIQUIDATE) → HOLD.
// liquidateTime은 'HH:MM' KST 24시간 표기. 없거나 형식이 잘못되면 시각 청산을 적용하지 않는다.
// nowMinutes는 KST 기준 자정 이후 분 수(0~1439). evaluateSell 호출 측이 제공한다.
export function evaluateSell({
  currentPrice, averagePrice, targetProfitRate, stopLossRate,
  liquidateTime = null, nowMinutes = null
}) {
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
  const liquidateMinutes = parseHhmmMinutes(liquidateTime);
  if (liquidateMinutes != null && Number.isFinite(Number(nowMinutes)) && Number(nowMinutes) >= liquidateMinutes) {
    return { decision: 'SELL', sellReason: 'TIME_LIQUIDATE', profitRate };
  }
  return { decision: 'HOLD', sellReason: null, profitRate };
}

// 'HH:MM'(24시간) 문자열을 자정 이후 분 수로 변환. 형식이 잘못되면 null.
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

// 현재 시각을 Asia/Seoul 자정 이후 분 수로 반환.
export function kstNowMinutes(now = new Date()) {
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return kst.getHours() * 60 + kst.getMinutes();
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
