// 한국 국장 상승률 랭킹 전략(KR_RANK_MOMENTUM)의 순수 판단 로직.
// KIS 호출·DB는 krRankService 가 담당하고, 여기서는 입력값만으로 결정한다.

// 진입 시 등락률이 이 값 이상인 종목은 매수 대상에서 제외한다.
// 오전은 20%, 점심은 오전 급등 뒤 되돌림 위험을 줄이기 위해 더 낮은 16%를 쓴다.
export const MAX_FLUCTUATION_RATE = 0.20;
export const ENTRY_MAX_FLUCTUATION_RATES = {
  MORNING: 0.20,
  LUNCH: 0.16
};

// 매수 필터 기본값 — 단기 흐름 검사용. krRankBuyFilter 절을 참고.
export const BUY_FILTER_DEFAULTS = {
  // 최근 거래량 추세 판정용. 직전 N봉 합 / 그 이전 N봉 합 비율이 이 값 미만이면 감소 추세로 본다.
  volumeShrinkRatio: 0.5,
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
export const FAST_STOP_LOSS_DEFAULTS = {
  minLossRate: 0.02,
  highPullbackRate: 0.03,
  openBreakRate: 0.008,
  maxHoldingMinutes: 20
};

// 진입 구간. 스케줄러 tick 간격(기본 30초)보다 넉넉히 잡아 한 구간을 반드시 한 번은 포착한다.
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
    score: scoreBuyCandidate(completedCandles, opts.candidate, opts)
  };
}

export function evaluateEntryFailure(candles, opts = {}) {
  const minCandles = opts.minimumCandles ?? BUY_FILTER_DEFAULTS.minimumCandles;
  if (!Array.isArray(candles) || candles.length < minCandles) {
    return { failed: false, reason: null };
  }
  const last = candles[candles.length - 1];
  const opening = Number(candles[0]?.open) || 0;
  const current = Number(last?.close) || 0;
  if (opening <= 0 || current <= 0) return { failed: false, reason: null };

  const vwap = computeVwap(candles);
  const priorSlice = candles.slice(0, -1);
  const recentHigh = Math.max(...priorSlice.map((c) => Number(c?.high) || 0), Number(last?.high) || 0);
  const highPullbackRate = recentHigh > 0 ? (recentHigh - current) / recentHigh : 0;
  const highPullbackThreshold = opts.highPullbackRate ?? 0.018;
  const openBreakRate = opts.openBreakRate ?? 0.003;
  const vwapBroken = vwap > 0 && current < vwap;
  const openBroken = current < opening * (1 - openBreakRate);
  const highPulledBack = highPullbackRate >= highPullbackThreshold;
  const volumeWeak = isVolumeDecreasing(candles, opts.trendWindow, opts.volumeShrinkRatio);
  const bearish = findLargeBearishCandle(candles, opts);

  if (vwapBroken && highPulledBack) {
    return {
      failed: true,
      reason: `현재가가 VWAP 아래로 내려갔고 최근 고점 대비 ${(highPullbackRate * 100).toFixed(1)}% 밀렸습니다.`
    };
  }
  if (openBroken && (volumeWeak || bearish)) {
    return {
      failed: true,
      reason: `현재가가 장 초반 기준가 아래로 내려갔고 ${volumeWeak ? '거래량이 줄었습니다' : '거래량을 동반한 음봉이 나왔습니다'}.`
    };
  }
  if (bearish && highPulledBack) {
    return {
      failed: true,
      reason: `거래량을 동반한 음봉 이후 최근 고점 대비 ${(highPullbackRate * 100).toFixed(1)}% 밀렸습니다.`
    };
  }
  return { failed: false, reason: null };
}

export function evaluateFastStopLoss(candles, { profitRate = 0, ...opts } = {}) {
  const maxHoldingMinutes = opts.maxHoldingMinutes ?? FAST_STOP_LOSS_DEFAULTS.maxHoldingMinutes;
  const holdingMinutes = Number(opts.holdingMinutes);
  if (Number.isFinite(holdingMinutes) && holdingMinutes > maxHoldingMinutes) {
    return { failed: false, reason: null };
  }

  const minLossRate = opts.minLossRate ?? FAST_STOP_LOSS_DEFAULTS.minLossRate;
  const currentLossRate = -Number(profitRate || 0);
  if (!Number.isFinite(currentLossRate) || currentLossRate < minLossRate) {
    return { failed: false, reason: null };
  }
  return evaluateEntryFailure(candles, {
    ...opts,
    highPullbackRate: opts.highPullbackRate ?? FAST_STOP_LOSS_DEFAULTS.highPullbackRate,
    openBreakRate: opts.openBreakRate ?? FAST_STOP_LOSS_DEFAULTS.openBreakRate
  });
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

function nowKstHms() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hh = String(kst.getHours()).padStart(2, '0');
  const mm = String(kst.getMinutes()).padStart(2, '0');
  const ss = String(kst.getSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}
