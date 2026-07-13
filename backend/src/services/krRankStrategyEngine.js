// 한국 국장 상승률 랭킹 전략(KR_RANK_MOMENTUM)의 순수 판단 로직.
// KIS 호출·DB는 krRankService 가 담당하고, 여기서는 입력값만으로 결정한다.

// 진입 시 등락률이 이 값 이상인 종목은 매수 대상에서 제외한다.
// 오전은 21%, 점심은 오전 급등 뒤 되돌림 위험을 줄이기 위해 더 낮은 15%를 쓴다.
export const MAX_FLUCTUATION_RATE = 0.21;
export const ENTRY_MAX_FLUCTUATION_RATES = {
  MORNING: 0.21,
  LUNCH: 0.15
};

// 매수 필터 기본값 — 단기 흐름 검사용. krRankBuyFilter 절을 참고.
export const BUY_FILTER_DEFAULTS = {
  // 최근 거래량 추세 판정용. 직전 N봉 합 / 그 이전 N봉 합 비율이 이 값 미만이면 감소 추세로 본다.
  volumeShrinkRatio: 0.5,
  // 가장 최근 완성봉에 실제 체결이 없으면(거래량 0) 그 종가는 직전가가 그대로 박힌 유령 가격이라
  // 단기 흐름·VWAP 이격 판단을 신뢰할 수 없다. 거래가 마른 분봉을 신호로 삼아 다음 봉 시초 급등을
  // 시장가로 추격하던 슬리피지 사고(예: 한빛소프트 047080)를 막기 위해 최소 거래량을 요구한다.
  minLastCandleVolume: 1,
  // 저유동성 급등주는 한두 체결로도 손절선을 훑을 수 있어 거래대금 하한을 둔다.
  // KIS 국내 당일 분봉은 최근 최대 30봉 중심으로 오므로, 오전 09:10에는 09:00~09:10 누적,
  // 점심 11:30에는 직전 약 30분 누적 거래대금을 검사하는 효과가 있다.
  minTurnoverAmount: 300_000_000,
  recentTurnoverWindow: 3,
  minRecentTurnoverAmount: 30_000_000,
  // 장대 음봉 판정 — 몸통(시가-종가)이 시가 대비 이 비율 이상이고 거래량이 최근 평균 대비 이 배수 이상이면 거절.
  bearishBodyMinRate: 0.005,
  bearishVolumeMultiplier: 1.2,
  // 단기 고점 돌파 실패 — 마지막 종가가 최근 N봉(마지막 제외) 최고가의 이 비율 미만이면 거절.
  highBreakoutTolerance: 0.995,
  // VWAP 바로 위에서 흔들리는 종목을 피하기 위한 최소 이격. 0.1% 이상 위에 있을 때만 통과.
  vwapBufferRate: 0.001,
  // VWAP 위에 있어도 평균가에서 너무 멀면 급등 막판 추격 위험이 커 거절한다.
  maxVwapPremiumRate: 0.08,
  lunchMaxVwapPremiumRate: 0.06,
  // 점심 진입은 오전 전체 VWAP만 보면 급등 직전 평균에 끌려 과열을 놓칠 수 있어 최근 VWAP도 함께 본다.
  lunchRecentVwapWindow: 30,
  lunchRecentVwapBufferRate: 0.001,
  lunchRecentVwapMaxPremiumRate: 0.04,
  // 짧은 시간에 수직 급등한 후보는 되돌림 위험이 커 거절한다.
  rapidRiseWindow: 3,
  rapidRiseMaxRate: 0.04,
  extendedRapidRiseWindow: 8,
  extendedRapidRiseMaxRate: 0.07,
  // 최근 고점 대비 이 비율 이상 밀린 후보는 이미 꺾인 흐름으로 본다.
  highPullbackMaxRate: 0.012,
  // 최근 완성봉들이 VWAP 아래로 닫혔는지 확인할 봉 수.
  recentVwapWindow: 2,
  // 필터에 쓸 최근 분봉 수. 30분이면 9:10 평가 시점에 9봉(09:01~09:09)만 들어와 부족할 수 있어
  // 최소 봉 수도 함께 둔다.
  minimumCandles: 3,
  trendWindow: 3,
  bearishWindow: 10,
  breakoutWindow: 10
};

// 빠른 손절 기본값. 분봉 흐름이 깨졌다는 신호만으로 바로 팔지 않고,
// 실제 손실이 일정 수준 이상일 때만 고정 손절률 전에 방어 매도를 시도한다.
//
// 모멘텀주는 진입 직후 흔들기(아래꼬리)로 정상적 변동을 보이는데, 단일 봉·절대 고점 기준·고정
// 저변동 트리거는 이를 추세 붕괴로 오판해 국소 저점에 매도하는 헛손절을 낸다(엠케이전자 033160,
// 지놈앤컴퍼니 314130 사례). 이를 막기 위해 세 가지 방어를 둔다.
//   (1) 확인: 마지막 confirmBars개 완성봉이 VWAP 아래에 연속으로 머물고, 직전 봉 종가를 회복(반등)
//       하지 않을 때만 붕괴로 본다. 한 봉 아래꼬리로는 발동하지 않는다.
//   (2) 구조 기준: "절대 고점 대비 N% 되돌림"이 아니라 VWAP 지속 이탈 + 최근 스윙 저점(지지) 이탈로
//       판정한다. 진입 스파이크 꼬리에 휘둘리지 않는다.
//   (3) 변동성 적응형 트리거: 손실 하한을 고정값과 최근 ATR(평균 봉 범위)의 배수 중 큰 값으로 둔다.
//       출렁임이 큰 종목은 더 큰 붕괴가 있어야 발동해 노이즈 손절을 줄인다.
export const FAST_STOP_LOSS_DEFAULTS = {
  // (3) 손실 하한(노이즈 컷). 실제 손실이 이 값과 atrLossMultiplier×ATR 중 큰 값을 넘어야 발동.
  minLossRate: 0.02,
  atrLossMultiplier: 2.5,
  atrWindow: 10,
  // (1) 연속 확인 봉 수. 마지막 N개 완성봉이 모두 붕괴 상태여야 발동.
  confirmBars: 2,
  // (2) 지지(스윙 저점) 이탈 판정에 볼 최근 봉 수.
  swingLowWindow: 10,
  openBreakRate: 0.008,
  maxHoldingMinutes: 20
};

// 빠른 손절 시간대를 지난 뒤 천천히 무너지는 보유분을 방어한다.
// 일반 손절(-5%)까지 기다리기 전에, 목표가 주문이 오래 미체결이고 분봉 흐름이 VWAP 아래로
// 굳어진 경우에만 방어 매도를 검토한다. 진입 직후 흔들기는 FAST_STOP_LOSS_DEFAULTS가 담당한다.
export const MID_TRADE_DEFENSE_DEFAULTS = {
  minHoldingMinutes: 20,
  minTargetOrderAgeMinutes: 45,
  minLossRate: 0.03,
  belowVwapBars: 3,
  swingLowWindow: 12
};

// 고정 손절선에 닿았더라도 매수 직후 흔들기 가능성이 높으면 즉시 매도하지 않고 확인한다.
// 다만 실제 폭락을 방치하지 않도록 유예 가능한 최대 손실과 최대 시간은 제한한다.
export const STOP_LOSS_DEFERRAL_DEFAULTS = {
  maxHoldingMinutes: 10,
  maxDeferrableLossRate: 0.10,
  confirmBars: 3,
  swingLowWindow: 10,
  // 과감한 손절 ①(속도): 직전 완성봉 하락률이 ATR%의 이 배수를 넘고, 절대 하락도 minVelocityCutRate
  // 이상이면 흔들기가 아니라 칼낙(추세 붕괴)으로 보고 즉시 손절한다.
  velocityCutAtrMultiplier: 2.5,
  minVelocityCutRate: 0.025,
  // 과감한 손절 ②(거래량): 최근 구간 하락봉 평균 거래량이 상승봉 평균의 이 배수 이상이면
  // 손바뀜이 큰 분출 매도로 보고 즉시 손절한다.
  climaxVolumeMultiplier: 2.0,
  volumeWindow: 6
};

// 진입 구간. 스케줄러 tick 간격(기본 30초)보다 넉넉히 잡아 한 구간을 반드시 한 번은 포착한다.
export const ENTRY_WINDOWS = {
  MORNING: { label: '오전', startMinutes: 9 * 60 + 10, endMinutes: 10 * 60 },
  LUNCH: { label: '점심', startMinutes: 11 * 60 + 30, endMinutes: 12 * 60 + 20 }
};

export const ENTRY_OBSERVATION_WINDOWS = {
  MORNING: { label: '오전 관찰', startMinutes: 9 * 60, endMinutes: ENTRY_WINDOWS.MORNING.startMinutes },
  LUNCH: { label: '점심 관찰', startMinutes: 11 * 60 + 20, endMinutes: ENTRY_WINDOWS.LUNCH.startMinutes }
};

export const RANKING_OBSERVATION_DEFAULTS = {
  candidateLimit: 5,
  minSnapshotsForStability: 3,
  minAppearancesWhenStable: 2,
  perSnapshotCandidateLimit: 10
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

export function resolveEntryObservationWindow(now = new Date(), { lunchEntryEnabled = false } = {}) {
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return null;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  const inWindow = (w) => minutes >= w.startMinutes && minutes < w.endMinutes;
  if (inWindow(ENTRY_OBSERVATION_WINDOWS.MORNING)) return 'MORNING';
  if (lunchEntryEnabled && inWindow(ENTRY_OBSERVATION_WINDOWS.LUNCH)) return 'LUNCH';
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
    if (excludedKrRankIssueReason(item)) continue;
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

export function maxFluctuationRateForEntryWindow(entryWindow) {
  return ENTRY_MAX_FLUCTUATION_RATES[entryWindow] ?? MAX_FLUCTUATION_RATE;
}

export function excludedKrRankIssueReason(candidate = {}) {
  const rawName = String(candidate?.name || '').trim();
  if (!rawName) return null;
  const upperName = rawName.toUpperCase();
  if (/우선주|우선/.test(rawName) || /우[ABC]?$/.test(rawName)) {
    return '우선주는 변동성과 유동성 위험이 커 매수하지 않습니다.';
  }
  const specialKeywords = ['ETF', 'ETN', '스팩', 'SPAC', '리츠', 'REIT', '레버리지', '인버스', '선물'];
  if (specialKeywords.some((keyword) => upperName.includes(keyword))) {
    return 'ETF/ETN/스팩/리츠/파생형 상품은 전략 대상이 아니라 매수하지 않습니다.';
  }
  const productPrefixes = ['KODEX', 'TIGER', 'ACE', 'SOL', 'KBSTAR', 'HANARO', 'KOSEF', 'KIWOOM', 'RISE', 'PLUS', 'TIMEFOLIO', 'ARIRANG'];
  if (productPrefixes.some((prefix) => upperName.startsWith(prefix))) {
    return '상장지수·파생형 상품명으로 판단되어 매수하지 않습니다.';
  }
  return null;
}

// ── 단기 흐름 매수 필터 ───────────────────────────────────────────────
//
// 등락률 랭킹 상위라 해서 무조건 매수하지 않는다. 9시 10분 진입 직전까지의 분봉으로
// 다음 조건들을 본다:
//   1) 현재가가 시가보다 위에 있는가
//   2) 현재가가 VWAP(누적 거래량가중 평균가)보다 0.1% 이상 위에 있는가
//   3) 현재가가 VWAP에서 과도하게 멀지 않은가(점심은 더 엄격)
//   4) 점심 진입이면 최근 VWAP 기준으로도 과열되지 않았는가
//   5) 최근 3분·8분 수직 급등 후보가 아닌가
//   6) 최근 완성봉 2개가 VWAP 위에서 닫혔는가
//   7) 직전 N봉 거래량 합이 그 이전 N봉 거래량 합보다 너무 줄지 않았는가(거래량 유지)
//   8) 최근 N봉 중 거래량을 동반한 장대 음봉이 있는가(있으면 거절)
//   9) 최근 고점 대비 1.2% 이상 밀렸거나 직전 고점 돌파 흐름이 깨졌는가(있으면 거절)
// 모두 통과해야 매수 후보로 본다. 분봉이 부족하면 보수적으로 거절한다.

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

export function getCompletedMinuteCandles(candles, { nowHms = nowKstHms() } = {}) {
  if (!Array.isArray(candles)) return [];
  const normalized = candles
    .filter(Boolean)
    .slice()
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  const nowMinute = String(nowHms || '').padStart(6, '0').slice(0, 4);
  if (!/^\d{4}$/.test(nowMinute)) return normalized;
  return normalized.filter((c) => String(c?.time || '').padStart(6, '0').slice(0, 4) < nowMinute);
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

export function highPullbackRate(candles, opts = {}) {
  const window = opts.window ?? BUY_FILTER_DEFAULTS.breakoutWindow;
  if (!Array.isArray(candles) || candles.length < 3) return 0;
  const last = candles[candles.length - 1];
  const recent = candles.slice(-Math.min(window, candles.length));
  const recentHigh = Math.max(...recent.map((c) => Number(c?.high) || 0));
  const close = Number(last?.close) || 0;
  if (recentHigh <= 0 || close <= 0) return 0;
  return Math.max(0, (recentHigh - close) / recentHigh);
}

export function recentCloseRiseRate(candles, window = BUY_FILTER_DEFAULTS.rapidRiseWindow) {
  if (!Array.isArray(candles) || candles.length <= window) return 0;
  const last = candles[candles.length - 1];
  const base = candles[candles.length - 1 - window];
  const close = Number(last?.close) || 0;
  const baseClose = Number(base?.close) || 0;
  if (close <= 0 || baseClose <= 0) return 0;
  return (close - baseClose) / baseClose;
}

export function computeTurnoverAmount(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return 0;
  return candles.reduce((sum, c) => {
    const close = Number(c?.close) || 0;
    const volume = Math.max(0, Number(c?.volume) || 0);
    return close > 0 ? sum + close * volume : sum;
  }, 0);
}

// 직전 완성봉의 하락률 (이전 종가 대비). 양수면 하락, 0 이하면 보합/상승.
export function recentBarDropRate(candles) {
  if (!Array.isArray(candles) || candles.length < 2) return 0;
  const prevClose = Number(candles[candles.length - 2]?.close) || 0;
  const lastClose = Number(candles[candles.length - 1]?.close) || 0;
  if (prevClose <= 0 || lastClose <= 0) return 0;
  return (prevClose - lastClose) / prevClose;
}

// 최근 구간 하락봉/상승봉의 평균 거래량 비율. 분출 매도(손바뀜) 판단용.
// 상승봉 또는 하락봉이 하나도 없으면 비교 불가로 null.
export function downUpVolumeRatio(candles, window = STOP_LOSS_DEFERRAL_DEFAULTS.volumeWindow) {
  if (!Array.isArray(candles) || candles.length === 0) return null;
  const slice = candles.slice(-window);
  let downVol = 0;
  let downN = 0;
  let upVol = 0;
  let upN = 0;
  for (const c of slice) {
    const open = Number(c?.open) || 0;
    const close = Number(c?.close) || 0;
    const volume = Math.max(0, Number(c?.volume) || 0);
    if (open <= 0 || close <= 0 || volume <= 0) continue;
    if (close < open) { downVol += volume; downN += 1; }
    else { upVol += volume; upN += 1; }
  }
  if (downN === 0 || upN === 0) return null;
  const downAvg = downVol / downN;
  const upAvg = upVol / upN;
  if (upAvg <= 0) return null;
  return { ratio: downAvg / upAvg, downBars: downN, upBars: upN };
}

export function scoreBuyCandidate(candles, candidate = {}, opts = {}) {
  const vwap = computeVwap(candles);
  const last = Array.isArray(candles) ? candles[candles.length - 1] : null;
  const current = Number(last?.close) || Number(candidate.price) || 0;
  const opening = Number(candles?.[0]?.open) || 0;
  const pullback = highPullbackRate(candles, opts);
  const recentVolume = Array.isArray(candles)
    ? candles.slice(-BUY_FILTER_DEFAULTS.trendWindow).reduce((sum, c) => sum + (Number(c?.volume) || 0), 0)
    : 0;
  const priorVolume = Array.isArray(candles)
    ? candles.slice(-BUY_FILTER_DEFAULTS.trendWindow * 2, -BUY_FILTER_DEFAULTS.trendWindow).reduce((sum, c) => sum + (Number(c?.volume) || 0), 0)
    : 0;
  const vwapGap = vwap > 0 && current > 0 ? (current - vwap) / vwap : 0;
  const openGap = opening > 0 && current > 0 ? (current - opening) / opening : 0;
  const volumeRatio = priorVolume > 0 ? recentVolume / priorVolume : 1;
  const fluctuationRate = Number(candidate.fluctuationRate) || 0;

  let score = 0;
  score += Math.min(Math.max(vwapGap, 0), 0.03) * 1000;
  score += Math.min(Math.max(openGap, 0), 0.05) * 400;
  score += Math.min(volumeRatio, 3) * 5;
  score -= pullback * 1500;
  score -= Math.max(0, fluctuationRate - 0.10) * 200;
  if (last && Number(last.close) > Number(last.open)) score += 4;
  if (findLargeBearishCandle(candles, opts)) score -= 30;
  return score;
}

// 매수 필터의 통합 진입점. ok=true면 매수 후보로 통과, false면 reason에 거절 사유.
export function checkBuyCandidate(candles, opts = {}) {
  const issueReason = excludedKrRankIssueReason(opts.candidate);
  if (issueReason) {
    return { ok: false, reason: issueReason };
  }
  const completedCandles = opts.useCompletedCandles === false
    ? (Array.isArray(candles) ? candles : [])
    : getCompletedMinuteCandles(candles, opts);
  const minCandles = opts.minimumCandles ?? BUY_FILTER_DEFAULTS.minimumCandles;
  if (!Array.isArray(completedCandles) || completedCandles.length < minCandles) {
    return { ok: false, reason: '분봉 데이터가 부족해 단기 흐름을 확인할 수 없습니다.' };
  }
  const last = completedCandles[completedCandles.length - 1];
  const opening = Number(completedCandles[0]?.open) || 0;
  const current = Number(last?.close) || 0;
  if (opening <= 0 || current <= 0) {
    return { ok: false, reason: '분봉 시가/현재가가 비어 있어 단기 흐름을 확인할 수 없습니다.' };
  }

  if (current <= opening) {
    return { ok: false, reason: `현재가 ${fmtPrice(current)}원이 시가 ${fmtPrice(opening)}원 아래라 매수하지 않습니다.` };
  }

  // 가장 최근 완성봉에 체결이 없으면(거래량 0) current=last.close 가 유령 가격이라 진입 신호로 못 쓴다.
  const minLastCandleVolume = opts.minLastCandleVolume ?? BUY_FILTER_DEFAULTS.minLastCandleVolume;
  const lastVolume = Math.max(0, Number(last?.volume) || 0);
  if (lastVolume < minLastCandleVolume) {
    return { ok: false, reason: `최근 완성봉(${last?.time || '직전'}) 거래량이 ${lastVolume}이라 실제 체결이 없어 매수하지 않습니다.` };
  }

  const minTurnoverAmount = opts.minTurnoverAmount ?? BUY_FILTER_DEFAULTS.minTurnoverAmount;
  const turnoverAmount = computeTurnoverAmount(completedCandles);
  if (minTurnoverAmount > 0 && turnoverAmount < minTurnoverAmount) {
    return { ok: false, reason: `관찰 구간 거래대금이 ${fmtAmount(turnoverAmount)}원으로 ${fmtAmount(minTurnoverAmount)}원 미만이라 저유동성으로 보고 매수하지 않습니다.` };
  }
  const recentTurnoverWindow = opts.recentTurnoverWindow ?? BUY_FILTER_DEFAULTS.recentTurnoverWindow;
  const minRecentTurnoverAmount = opts.minRecentTurnoverAmount ?? BUY_FILTER_DEFAULTS.minRecentTurnoverAmount;
  const recentTurnoverAmount = computeTurnoverAmount(completedCandles.slice(-recentTurnoverWindow));
  if (minRecentTurnoverAmount > 0 && recentTurnoverAmount < minRecentTurnoverAmount) {
    return { ok: false, reason: `최근 ${recentTurnoverWindow}분 거래대금이 ${fmtAmount(recentTurnoverAmount)}원으로 ${fmtAmount(minRecentTurnoverAmount)}원 미만이라 저유동성으로 보고 매수하지 않습니다.` };
  }

  const vwap = computeVwap(completedCandles);
  const vwapBufferRate = opts.vwapBufferRate ?? BUY_FILTER_DEFAULTS.vwapBufferRate;
  const requiredVwap = vwap * (1 + vwapBufferRate);
  if (vwap > 0 && current < requiredVwap) {
    return { ok: false, reason: `현재가 ${fmtPrice(current)}원이 VWAP ${fmtPrice(vwap)}원 대비 충분히 높지 않아 매수하지 않습니다.` };
  }
  const entryWindow = opts.entryWindow || null;
  const maxVwapPremiumRate = opts.maxVwapPremiumRate ?? (
    entryWindow === 'LUNCH'
      ? BUY_FILTER_DEFAULTS.lunchMaxVwapPremiumRate
      : BUY_FILTER_DEFAULTS.maxVwapPremiumRate
  );
  const vwapPremium = vwap > 0 ? (current - vwap) / vwap : 0;
  if (vwap > 0 && vwapPremium > maxVwapPremiumRate) {
    return { ok: false, reason: `현재가가 VWAP 대비 ${(vwapPremium * 100).toFixed(1)}% 높아 과열로 보고 매수하지 않습니다.` };
  }

  if (entryWindow === 'LUNCH') {
    const lunchRecentVwapWindow = opts.lunchRecentVwapWindow ?? BUY_FILTER_DEFAULTS.lunchRecentVwapWindow;
    const lunchRecentCandles = completedCandles.slice(-lunchRecentVwapWindow);
    const lunchRecentVwap = computeVwap(lunchRecentCandles);
    const lunchRecentVwapBufferRate = opts.lunchRecentVwapBufferRate ?? BUY_FILTER_DEFAULTS.lunchRecentVwapBufferRate;
    const lunchRecentVwapMaxPremiumRate = opts.lunchRecentVwapMaxPremiumRate ?? BUY_FILTER_DEFAULTS.lunchRecentVwapMaxPremiumRate;
    if (lunchRecentVwap > 0 && current < lunchRecentVwap * (1 + lunchRecentVwapBufferRate)) {
      return { ok: false, reason: `점심 진입 현재가 ${fmtPrice(current)}원이 최근 VWAP ${fmtPrice(lunchRecentVwap)}원 대비 충분히 높지 않아 매수하지 않습니다.` };
    }
    const lunchRecentVwapPremium = lunchRecentVwap > 0 ? (current - lunchRecentVwap) / lunchRecentVwap : 0;
    if (lunchRecentVwap > 0 && lunchRecentVwapPremium > lunchRecentVwapMaxPremiumRate) {
      return { ok: false, reason: `점심 진입 현재가가 최근 VWAP 대비 ${(lunchRecentVwapPremium * 100).toFixed(1)}% 높아 과열로 보고 매수하지 않습니다.` };
    }
  }

  const rapidRiseWindow = opts.rapidRiseWindow ?? BUY_FILTER_DEFAULTS.rapidRiseWindow;
  const rapidRiseMaxRate = opts.rapidRiseMaxRate ?? BUY_FILTER_DEFAULTS.rapidRiseMaxRate;
  const rapidRise = recentCloseRiseRate(completedCandles, rapidRiseWindow);
  if (rapidRise >= rapidRiseMaxRate) {
    return { ok: false, reason: `최근 ${rapidRiseWindow}분 상승률이 ${(rapidRise * 100).toFixed(1)}%라 수직 급등으로 보고 매수하지 않습니다.` };
  }
  const extendedRapidRiseWindow = opts.extendedRapidRiseWindow ?? BUY_FILTER_DEFAULTS.extendedRapidRiseWindow;
  const extendedRapidRiseMaxRate = opts.extendedRapidRiseMaxRate ?? BUY_FILTER_DEFAULTS.extendedRapidRiseMaxRate;
  const extendedRapidRise = recentCloseRiseRate(completedCandles, extendedRapidRiseWindow);
  if (extendedRapidRise >= extendedRapidRiseMaxRate) {
    return { ok: false, reason: `최근 ${extendedRapidRiseWindow}분 상승률이 ${(extendedRapidRise * 100).toFixed(1)}%라 수직 급등으로 보고 매수하지 않습니다.` };
  }

  const recentVwapWindow = opts.recentVwapWindow ?? BUY_FILTER_DEFAULTS.recentVwapWindow;
  const recentVwapCandles = completedCandles.slice(-recentVwapWindow);
  if (vwap > 0 && recentVwapCandles.some((c) => Number(c?.close || 0) <= vwap)) {
    return { ok: false, reason: '최근 완성봉이 VWAP 아래로 닫혀 매수하지 않습니다.' };
  }

  if (isVolumeDecreasing(completedCandles, opts.trendWindow, opts.volumeShrinkRatio)) {
    return { ok: false, reason: '최근 거래량이 직전 구간보다 크게 줄어 매수하지 않습니다.' };
  }

  const bearish = findLargeBearishCandle(completedCandles, opts);
  if (bearish) {
    return { ok: false, reason: '거래량을 동반한 장대 음봉이 발생해 매수하지 않습니다.' };
  }

  const pullback = highPullbackRate(completedCandles, opts);
  const pullbackLimit = opts.highPullbackMaxRate ?? BUY_FILTER_DEFAULTS.highPullbackMaxRate;
  if (pullback >= pullbackLimit) {
    return { ok: false, reason: `최근 고점 대비 ${(pullback * 100).toFixed(1)}% 밀려 매수하지 않습니다.` };
  }

  if (isFailingHighBreakout(completedCandles, opts)) {
    return { ok: false, reason: '직전 고점을 돌파하지 못하고 밀려 매수하지 않습니다.' };
  }

  return {
    ok: true,
    reason: null,
    candles: completedCandles,
    // 필터가 승인한 신호가(가장 최근 완성봉 종가). 실행 시점 실시간 현재가와 비교해 추격 매수를 거른다.
    referencePrice: current,
    score: scoreBuyCandidate(completedCandles, opts.candidate, opts)
  };
}

export function aggregateRankingCandidates(snapshots = [], opts = {}) {
  const maxFluctuationRate = opts.maxFluctuationRate ?? MAX_FLUCTUATION_RATE;
  const candidateLimit = opts.candidateLimit ?? RANKING_OBSERVATION_DEFAULTS.candidateLimit;
  const perSnapshotCandidateLimit = opts.perSnapshotCandidateLimit ?? RANKING_OBSERVATION_DEFAULTS.perSnapshotCandidateLimit;
  const minSnapshotsForStability = opts.minSnapshotsForStability ?? RANKING_OBSERVATION_DEFAULTS.minSnapshotsForStability;
  const minAppearancesWhenStable = opts.minAppearancesWhenStable ?? RANKING_OBSERVATION_DEFAULTS.minAppearancesWhenStable;
  const normalized = Array.isArray(snapshots)
    ? snapshots.map((s) => Array.isArray(s) ? s : s?.rankingSnapshot).filter((s) => Array.isArray(s) && s.length > 0)
    : [];
  const stats = new Map();
  normalized.forEach((snapshot, snapshotIndex) => {
    const candidates = selectRankingCandidates(snapshot, { maxFluctuationRate }).slice(0, perSnapshotCandidateLimit);
    candidates.forEach((candidate, rankIndex) => {
      const rank = rankIndex + 1;
      const existing = stats.get(candidate.symbol) || {
        symbol: candidate.symbol,
        name: candidate.name,
        price: candidate.price,
        fluctuationRate: candidate.fluctuationRate,
        appearances: 0,
        rankSum: 0,
        bestRank: rank,
        latestRank: rank,
        latestSnapshotIndex: snapshotIndex,
        fluctuationSum: 0
      };
      existing.name = candidate.name || existing.name;
      existing.price = candidate.price;
      existing.fluctuationRate = candidate.fluctuationRate;
      existing.appearances += 1;
      existing.rankSum += rank;
      existing.bestRank = Math.min(existing.bestRank, rank);
      existing.latestRank = rank;
      existing.latestSnapshotIndex = snapshotIndex;
      existing.fluctuationSum += candidate.fluctuationRate;
      stats.set(candidate.symbol, existing);
    });
  });

  const requireRepeatedAppearance = normalized.length >= minSnapshotsForStability;
  const all = Array.from(stats.values());
  const repeated = all.filter((s) => s.appearances >= minAppearancesWhenStable);
  // 관찰 스냅샷이 충분히 쌓인 뒤에는 반복 출현(지속성)한 종목만 후보로 본다.
  // 모든 종목이 한 번씩만 나타난 난조장은 단발 후보로 되돌아가지 않고 진입을 건너뛴다.
  const eligible = requireRepeatedAppearance ? repeated : all;
  return eligible
    .map((s) => {
      const averageRank = s.rankSum / s.appearances;
      const appearanceRate = normalized.length > 0 ? s.appearances / normalized.length : 0;
      const recencyBonus = normalized.length > 0 ? (s.latestSnapshotIndex + 1) / normalized.length : 0;
      const observationScore = appearanceRate * 20
        + Math.max(0, 11 - averageRank) * 1.5
        + Math.max(0, 11 - s.bestRank) * 0.7
        + recencyBonus * 8
        + Math.min(Math.max(s.fluctuationSum / s.appearances, 0), 0.21) * 20;
      return {
        symbol: s.symbol,
        name: s.name || s.symbol,
        price: s.price,
        fluctuationRate: s.fluctuationRate,
        observationCount: s.appearances,
        observationSnapshots: normalized.length,
        averageRank,
        bestRank: s.bestRank,
        latestRank: s.latestRank,
        observationScore
      };
    })
    .sort((a, b) => (
      b.observationScore - a.observationScore
      || a.averageRank - b.averageRank
      || b.fluctuationRate - a.fluctuationRate
      || a.symbol.localeCompare(b.symbol)
    ))
    .slice(0, candidateLimit);
}

// 최근 봉의 평균 True Range를 현재가 대비 비율(ATR%)로 돌려준다. 변동성 적응형 빠른손절 트리거용.
export function computeAtrRate(candles, window = FAST_STOP_LOSS_DEFAULTS.atrWindow) {
  if (!Array.isArray(candles) || candles.length < 2) return 0;
  const slice = candles.slice(-window);
  let sumTr = 0;
  let count = 0;
  let lastClose = 0;
  let prevClose = Number(slice[0]?.close) || 0;
  for (let i = 0; i < slice.length; i += 1) {
    const high = Number(slice[i]?.high) || 0;
    const low = Number(slice[i]?.low) || 0;
    const close = Number(slice[i]?.close) || 0;
    if (high <= 0 || low <= 0 || close <= 0) continue;
    const tr = i === 0 || prevClose <= 0
      ? high - low
      : Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    if (tr >= 0) { sumTr += tr; count += 1; }
    prevClose = close;
    lastClose = close;
  }
  if (count === 0 || lastClose <= 0) return 0;
  return (sumTr / count) / lastClose;
}

// 진입 후 흐름이 구조적으로 깨졌는지 판정한다(흔들기와 구분).
// 발동 조건: 마지막 confirmBars개 완성봉이 VWAP 아래 종가로 연속(확인) + 직전 봉 회복(반등) 없음
//   + (최근 스윙 저점 이탈[지지 붕괴] 또는 거래량 동반 장대 음봉). 장 초반 기준가 이탈은 보강 신호.
export function evaluateEntryFailure(candles, opts = {}) {
  const minCandles = opts.minimumCandles ?? BUY_FILTER_DEFAULTS.minimumCandles;
  if (!Array.isArray(candles) || candles.length < minCandles) {
    return { failed: false, reason: null };
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const opening = Number(candles[0]?.open) || 0;
  const current = Number(last?.close) || 0;
  if (opening <= 0 || current <= 0) return { failed: false, reason: null };

  const vwap = computeVwap(candles);
  if (vwap <= 0) return { failed: false, reason: null };

  // (1) 흔들기 반등 보류: 마지막 봉이 직전 봉 종가를 회복하면(상승 전환) 붕괴로 보지 않는다.
  const prevClose = Number(prev?.close) || 0;
  if (prevClose > 0 && current > prevClose) {
    return { failed: false, reason: null };
  }
  // (1) 확인: 마지막 confirmBars개 완성봉이 모두 VWAP 아래 종가여야 한다(지속 이탈).
  const confirmBars = Math.max(1, Math.floor(opts.confirmBars ?? FAST_STOP_LOSS_DEFAULTS.confirmBars));
  const tail = candles.slice(-confirmBars);
  const sustainedBelowVwap = tail.length >= confirmBars
    && tail.every((c) => Number(c?.close || 0) > 0 && Number(c?.close) < vwap);
  if (!sustainedBelowVwap) {
    return { failed: false, reason: null };
  }

  // (2) 구조 기준: 마지막 봉을 뺀 최근 스윙 저점(지지) 아래로 내려갔는가.
  const swingLowWindow = opts.swingLowWindow ?? FAST_STOP_LOSS_DEFAULTS.swingLowWindow;
  const priorSlice = candles.slice(-Math.min(swingLowWindow + 1, candles.length), -1);
  const swingLows = priorSlice.map((c) => Number(c?.low) || Infinity).filter((v) => Number.isFinite(v));
  const swingLow = swingLows.length ? Math.min(...swingLows) : Infinity;
  const structureBroken = Number.isFinite(swingLow) && current < swingLow;

  const bearish = findLargeBearishCandle(candles, opts);
  const openBreakRate = opts.openBreakRate ?? FAST_STOP_LOSS_DEFAULTS.openBreakRate;
  const openBroken = current < opening * (1 - openBreakRate);
  const volumeWeak = isVolumeDecreasing(candles, opts.trendWindow, opts.volumeShrinkRatio);

  if (structureBroken) {
    return {
      failed: true,
      reason: `현재가가 VWAP 아래에서 ${confirmBars}봉 연속 머물고 최근 지지(스윙 저점 ${fmtPrice(swingLow)}원)도 이탈했습니다.`
    };
  }
  if (bearish) {
    return {
      failed: true,
      reason: `현재가가 VWAP 아래에서 ${confirmBars}봉 연속 머물고 거래량을 동반한 장대 음봉이 나왔습니다.`
    };
  }
  if (openBroken && volumeWeak) {
    return {
      failed: true,
      reason: `현재가가 장 초반 기준가·VWAP 아래로 ${confirmBars}봉 연속 내려갔고 거래량도 줄었습니다.`
    };
  }
  return { failed: false, reason: null };
}

export function evaluateFastStopLoss(candles, { profitRate = 0, useCompletedCandles = false, ...opts } = {}) {
  const maxHoldingMinutes = opts.maxHoldingMinutes ?? FAST_STOP_LOSS_DEFAULTS.maxHoldingMinutes;
  const holdingMinutes = Number(opts.holdingMinutes);
  if (Number.isFinite(holdingMinutes) && holdingMinutes > maxHoldingMinutes) {
    return { failed: false, reason: null };
  }

  // 라이브 평가는 진행 중(미완성) 분봉의 일시적 아래꼬리에 반응하지 않도록 마지막 봉을 떼고 본다.
  // (KST/ET 시간대에 무관하게 안전하도록 시각 비교 대신 마지막 한 봉만 제거한다.)
  // 복기/테스트는 평가 봉으로 끝나는 창을 그대로 넘기므로 플래그를 켜지 않는다.
  const rawCandles = Array.isArray(candles) ? candles : [];
  const evalCandles = useCompletedCandles && rawCandles.length > 0
    ? rawCandles.slice(0, -1)
    : rawCandles;

  // (3) 변동성 적응형 손실 하한: 고정값과 최근 ATR 배수 중 큰 값을 넘어야 빠른손절을 검토한다.
  const minLossRate = opts.minLossRate ?? FAST_STOP_LOSS_DEFAULTS.minLossRate;
  const atrMultiplier = opts.atrLossMultiplier ?? FAST_STOP_LOSS_DEFAULTS.atrLossMultiplier;
  const atrRate = computeAtrRate(evalCandles, opts.atrWindow ?? FAST_STOP_LOSS_DEFAULTS.atrWindow);
  const lossThreshold = Math.max(minLossRate, atrMultiplier * atrRate);
  const currentLossRate = -Number(profitRate || 0);
  if (!Number.isFinite(currentLossRate) || currentLossRate < lossThreshold) {
    return { failed: false, reason: null };
  }
  return evaluateEntryFailure(evalCandles, {
    ...opts,
    confirmBars: opts.confirmBars ?? FAST_STOP_LOSS_DEFAULTS.confirmBars,
    swingLowWindow: opts.swingLowWindow ?? FAST_STOP_LOSS_DEFAULTS.swingLowWindow,
    openBreakRate: opts.openBreakRate ?? FAST_STOP_LOSS_DEFAULTS.openBreakRate
  });
}

export function evaluateMidTradeDefense(candles, {
  profitRate = 0,
  holdingMinutes = null,
  targetOrderAgeMinutes = null,
  useCompletedCandles = false,
  ...opts
} = {}) {
  const minHoldingMinutes = opts.minHoldingMinutes ?? MID_TRADE_DEFENSE_DEFAULTS.minHoldingMinutes;
  const held = Number(holdingMinutes);
  if (!Number.isFinite(held) || held < minHoldingMinutes) {
    return { defensive: false, reason: null };
  }

  const minTargetOrderAgeMinutes = opts.minTargetOrderAgeMinutes ?? MID_TRADE_DEFENSE_DEFAULTS.minTargetOrderAgeMinutes;
  const targetAge = Number(targetOrderAgeMinutes);
  if (!Number.isFinite(targetAge) || targetAge < minTargetOrderAgeMinutes) {
    return { defensive: false, reason: null };
  }

  const minLossRate = opts.minLossRate ?? MID_TRADE_DEFENSE_DEFAULTS.minLossRate;
  const currentLossRate = -Number(profitRate || 0);
  if (!Number.isFinite(currentLossRate) || currentLossRate < minLossRate) {
    return { defensive: false, reason: null };
  }

  const rawCandles = Array.isArray(candles) ? candles : [];
  const evalCandles = useCompletedCandles && rawCandles.length > 0
    ? rawCandles.slice(0, -1)
    : rawCandles;
  const minCandles = Math.max(
    opts.minimumCandles ?? BUY_FILTER_DEFAULTS.minimumCandles,
    opts.belowVwapBars ?? MID_TRADE_DEFENSE_DEFAULTS.belowVwapBars
  );
  if (evalCandles.length < minCandles) {
    return { defensive: false, reason: null };
  }

  const vwap = computeVwap(evalCandles);
  if (vwap <= 0) return { defensive: false, reason: null };

  const belowVwapBars = Math.max(1, Math.floor(opts.belowVwapBars ?? MID_TRADE_DEFENSE_DEFAULTS.belowVwapBars));
  const tail = evalCandles.slice(-belowVwapBars);
  const stayedBelowVwap = tail.length >= belowVwapBars
    && tail.every((c) => Number(c?.close || 0) > 0 && Number(c?.close) < vwap);
  if (!stayedBelowVwap) {
    return { defensive: false, reason: null };
  }

  const last = evalCandles[evalCandles.length - 1];
  const prev = evalCandles[evalCandles.length - 2];
  const current = Number(last?.close) || 0;
  const prevClose = Number(prev?.close) || 0;
  if (current <= 0) return { defensive: false, reason: null };
  if (prevClose > 0 && current > prevClose) {
    return { defensive: false, reason: null };
  }

  const swingLowWindow = opts.swingLowWindow ?? MID_TRADE_DEFENSE_DEFAULTS.swingLowWindow;
  const priorSlice = evalCandles.slice(-Math.min(swingLowWindow + 1, evalCandles.length), -1);
  const swingLows = priorSlice.map((c) => Number(c?.low) || Infinity).filter((v) => Number.isFinite(v));
  const swingLow = swingLows.length ? Math.min(...swingLows) : Infinity;
  const structureBroken = Number.isFinite(swingLow) && current < swingLow;
  const volumeWeak = isVolumeDecreasing(evalCandles, opts.trendWindow, opts.volumeShrinkRatio);
  const bearish = findLargeBearishCandle(evalCandles, opts);

  if (!structureBroken && !volumeWeak && !bearish) {
    return { defensive: false, reason: null };
  }

  const structureNote = structureBroken
    ? `최근 지지(스윙 저점 ${fmtPrice(swingLow)}원)를 이탈`
    : (bearish ? '거래량을 동반한 장대 음봉 발생' : '최근 거래량 약화');
  return {
    defensive: true,
    reason: `목표가 주문이 ${Math.floor(targetAge)}분째 미체결이고 손실이 ${(currentLossRate * 100).toFixed(2)}%까지 커진 상태에서, 최근 ${belowVwapBars}개 완성봉이 VWAP 아래에 머물며 ${structureNote}했습니다.`
  };
}

export function evaluateStopLossDeferral(candles, {
  profitRate = 0,
  stopLossRate = 0.05,
  holdingMinutes = null,
  useCompletedCandles = false,
  ...opts
} = {}) {
  const currentLossRate = -Number(profitRate || 0);
  const configuredStopLossRate = Number(stopLossRate);
  if (!Number.isFinite(currentLossRate) || currentLossRate <= 0) return { defer: false, reason: null };
  if (Number.isFinite(configuredStopLossRate) && currentLossRate < configuredStopLossRate) {
    return { defer: false, reason: null };
  }

  const maxHoldingMinutes = opts.maxHoldingMinutes ?? STOP_LOSS_DEFERRAL_DEFAULTS.maxHoldingMinutes;
  const holding = Number(holdingMinutes);
  // 보유시간을 모르면(매도 대상 주문이 없거나 타임스탬프 누락) "방금 샀다"고 가정하지 않는다.
  // 유예는 갓 매수했음을 확신할 때만 하는 공격적 선택이라, 알 수 없으면 손절을 그대로 진행한다.
  if (holdingMinutes == null || !Number.isFinite(holding) || holding > maxHoldingMinutes) {
    return { defer: false, reason: null };
  }

  const maxDeferrableLossRate = opts.maxDeferrableLossRate ?? STOP_LOSS_DEFERRAL_DEFAULTS.maxDeferrableLossRate;
  if (currentLossRate >= maxDeferrableLossRate) {
    return {
      defer: false,
      reason: `손실이 ${(currentLossRate * 100).toFixed(2)}%로 흔들기 관찰 한도 ${(maxDeferrableLossRate * 100).toFixed(1)}%를 넘었습니다.`
    };
  }

  const rawCandles = Array.isArray(candles) ? candles : [];
  const evalCandles = useCompletedCandles && rawCandles.length > 0
    ? rawCandles.slice(0, -1)
    : rawCandles;
  if (evalCandles.length < BUY_FILTER_DEFAULTS.minimumCandles) {
    return {
      defer: true,
      reason: '완성 분봉이 부족해 손절선 이탈이 실제 추세 붕괴인지 아직 확인되지 않았습니다.'
    };
  }

  // 경과 시간(매직넘버 6분)으로 무조건 유예하지 않는다. 유예/손절은 "시계"가 아니라
  // "시장 성격"(속도·거래량·구조)으로 판단한다. 인내는 손실 한도(maxDeferrableLossRate)와
  // 보유시간 상한(maxHoldingMinutes)으로만 제한한다.

  // 과감한 손절 ①(속도): 직전 완성봉 하락이 변동성(ATR%)을 크게 초과하는 칼낙이면 즉시 손절.
  const atrRate = computeAtrRate(evalCandles);
  const dropRate = recentBarDropRate(evalCandles);
  const velocityMultiplier = opts.velocityCutAtrMultiplier ?? STOP_LOSS_DEFERRAL_DEFAULTS.velocityCutAtrMultiplier;
  const minVelocityCutRate = opts.minVelocityCutRate ?? STOP_LOSS_DEFERRAL_DEFAULTS.minVelocityCutRate;
  if (atrRate > 0 && dropRate >= atrRate * velocityMultiplier && dropRate >= minVelocityCutRate) {
    return {
      defer: false,
      reason: `직전 분봉 하락률 ${(dropRate * 100).toFixed(2)}%가 변동성(ATR ${(atrRate * 100).toFixed(2)}%)의 ${velocityMultiplier}배를 넘는 칼낙이라 흔들기가 아닌 붕괴로 보고 손절합니다.`
    };
  }

  // 과감한 손절 ②(거래량): 하락봉 평균 거래량이 상승봉 평균을 크게 웃돌면 분출 매도로 보고 즉시 손절.
  const climaxMultiplier = opts.climaxVolumeMultiplier ?? STOP_LOSS_DEFERRAL_DEFAULTS.climaxVolumeMultiplier;
  const volProfile = downUpVolumeRatio(evalCandles, opts.volumeWindow ?? STOP_LOSS_DEFERRAL_DEFAULTS.volumeWindow);
  if (volProfile && volProfile.ratio >= climaxMultiplier) {
    return {
      defer: false,
      reason: `하락봉 평균 거래량이 상승봉 평균의 ${volProfile.ratio.toFixed(2)}배라 분출 매도로 보고 손절합니다.`
    };
  }

  // 구조 붕괴 확인: VWAP 아래 지속 이탈 + 지지 붕괴가 확인되면 손절(단일 아래꼬리는 통과).
  const failure = evaluateEntryFailure(evalCandles, {
    ...opts,
    confirmBars: opts.confirmBars ?? STOP_LOSS_DEFERRAL_DEFAULTS.confirmBars,
    swingLowWindow: opts.swingLowWindow ?? STOP_LOSS_DEFERRAL_DEFAULTS.swingLowWindow
  });
  if (failure.failed) {
    return { defer: false, reason: failure.reason };
  }

  // 칼낙·분출 매도·구조 붕괴 모두 아님 → 초기 흔들기로 보고 유예. 하락봉이 저거래량이면 근거를 덧붙인다.
  const lowVolumeNote = volProfile && volProfile.ratio < 1
    ? ` 하락봉 거래량은 상승봉의 ${volProfile.ratio.toFixed(2)}배로 작아 흔들기 가능성이 큽니다.`
    : '';
  return {
    defer: true,
    reason: `손실은 ${(currentLossRate * 100).toFixed(2)}%지만 칼낙·분출 매도·구조 붕괴가 아직 확인되지 않아 초기 흔들기로 보고 관찰합니다.${lowVolumeNote}`
  };
}

function fmtPrice(value) {
  return Math.round(Number(value) || 0).toLocaleString('ko-KR');
}

function fmtAmount(value) {
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

function nowKstHms() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hh = String(kst.getHours()).padStart(2, '0');
  const mm = String(kst.getMinutes()).padStart(2, '0');
  const ss = String(kst.getSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}
