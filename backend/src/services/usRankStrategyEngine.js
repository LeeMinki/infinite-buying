// 미국 상승률 랭킹 전략(US_RANK_MOMENTUM)의 순수 판단 로직.
// KIS 호출·DB 기록은 usRankService 가 담당하고, 여기서는 시간 판정과 매수/매도 판단만 한다.

// 매수 후보 단기 흐름 검사는 국장 전략의 검증된 순수 캔들 함수를 그대로 재사용한다.
import {
  BUY_FILTER_DEFAULTS,
  computeVwap,
  isVolumeDecreasing,
  findLargeBearishCandle,
  isFailingHighBreakout
} from './krRankStrategyEngine.js';

export const DEFAULT_TARGET_PROFIT_RATE = 0.02;
export const DEFAULT_STOP_LOSS_RATE = 0.05;
export const DEFAULT_FORCE_CLOSE_KST = '04:30';
// 진입 유니버스 1차 필터. 상승률 1위라고 무조건 사지 않고, 변동성·유동성이 위험한 종목군을 먼저 배제한다.
//   - 최소 가격 $5: $1~4 초저가(micro/penny) 종목은 스프레드·호가 공백이 커서 진입·청산 슬리피지가 크다.
//     실거래에서 $0.32·$1.6 종목이 펌프 후 급락해 −10%대 손실을 냈던 패턴을 막는다.
//   - 최소 거래대금 $50M: 주 수(거래량)만으로는 저가주가 통과하므로 가격×거래량(달러 유동성)으로 거른다.
//   - 등락률 상한 +50%: 미국장은 가격제한폭이 없어 +100%도 가능한데, 이미 수직 급등한 종목을 추격하면
//     블로우오프 고점을 사게 된다. 상한 이상이면 건너뛰고 차순위 후보를 본다.
export const US_RANK_MIN_PRICE = 5;
export const US_RANK_MIN_VOLUME = 10_000_000;
export const US_RANK_MIN_TURNOVER_USD = 50_000_000;
export const US_MAX_FLUCTUATION_RATE = 0.50;
// 단기 흐름 필터의 과열 기준 — 현재가가 당일 VWAP보다 이 비율 넘게 높으면(평균에서 과도하게 이탈) 되돌림
// 위험이 커 매수하지 않는다. "VWAP 위"만 보면 급등 막판에도 당연히 참이라 꼭대기를 통과시키는 문제를 보완.
export const US_OVERHEAT_MAX_VWAP_PREMIUM = 0.15;
// 단기 흐름 필터에 적용할 상위 후보 개수. 1위부터 차례로 분봉을 검사해 통과한 첫 종목을 산다.
// 미국장은 정규장 내내 평가하므로 KIS 분봉 호출량(rate limit)을 고려해 국장(5)보다 보수적으로 둔다.
export const US_RANK_CANDIDATE_LIMIT = 3;

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
  if (isUsMarketHoliday(et.year, et.month, et.day)) return false;
  const minutes = et.hour * 60 + et.minute;
  return minutes >= 10 * 60 && minutes < 16 * 60;
}

// NYSE/NASDAQ 정규 휴장일을 규칙으로 계산한다. KIS에는 미국 휴장일 API가 없어,
// 공휴일에 매수를 반복 시도·로그하지 않도록 직접 판정한다.
// 고정일(신정·6/19·7/4·12/25)은 토요일이면 직전 금요일, 일요일이면 다음 월요일로 대체된다.
// (단 신정은 토요일이어도 대체휴장하지 않는 NYSE 관례를 따른다.)
// 변동일은 MLK(1월 3번째 월)·대통령의 날(2월 3번째 월)·성금요일(부활절 직전 금)·
// 메모리얼데이(5월 마지막 월)·노동절(9월 1번째 월)·추수감사절(11월 4번째 목).
// 조기 폐장(반일장)은 다루지 않는다 — 그 시간대 미체결 주문이 거부될 뿐 잘못된 매매로 이어지지 않는다.
export function isUsMarketHoliday(year, month, day) {
  return nyseHolidaySet(year).has(`${month}-${day}`);
}

const nyseHolidayCache = new Map();

function nyseHolidaySet(year) {
  if (nyseHolidayCache.has(year)) return nyseHolidayCache.get(year);
  const set = new Set();
  const add = (m, d) => set.add(`${m}-${d}`);
  const addObserved = (m, d, { newYear = false } = {}) => {
    const date = new Date(Date.UTC(year, m - 1, d));
    const wd = date.getUTCDay();
    if (wd === 6 && !newYear) date.setUTCDate(date.getUTCDate() - 1); // 토 → 금
    else if (wd === 0) date.setUTCDate(date.getUTCDate() + 1); // 일 → 월
    add(date.getUTCMonth() + 1, date.getUTCDate());
  };

  addObserved(1, 1, { newYear: true }); // 신정
  add(...monthDay(nthWeekday(year, 1, 1, 3))); // MLK (1월 셋째 월)
  add(...monthDay(nthWeekday(year, 2, 1, 3))); // 대통령의 날 (2월 셋째 월)
  add(...monthDay(goodFriday(year))); // 성금요일
  add(...monthDay(lastWeekday(year, 5, 1))); // 메모리얼데이 (5월 마지막 월)
  addObserved(6, 19); // 준틴스(2021~)
  addObserved(7, 4); // 독립기념일
  add(...monthDay(nthWeekday(year, 9, 1, 1))); // 노동절 (9월 첫째 월)
  add(...monthDay(nthWeekday(year, 11, 4, 4))); // 추수감사절 (11월 넷째 목)
  addObserved(12, 25); // 크리스마스

  nyseHolidayCache.set(year, set);
  return set;
}

function monthDay(date) {
  return [date.getUTCMonth() + 1, date.getUTCDate()];
}

// year/month(1-12)의 n번째 weekday(0=일~6=토) 날짜.
function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7));
}

function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0)); // 해당 월 마지막 날
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month - 1, last.getUTCDate() - offset));
}

// 부활절(서방교회, Computus)의 직전 금요일 = 성금요일.
function goodFriday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return easter;
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

// 진입 유니버스 1차 필터. 등락률 상위라고 무조건 사지 않고 위험한 종목군을 먼저 배제한다:
//   - 등락률 상한(US_MAX_FLUCTUATION_RATE) 이상 = 이미 수직 급등 → 추격 금지(블로우오프 회피).
//   - 최소 가격(US_RANK_MIN_PRICE) 미만 = 초저가 micro-cap → 스프레드·호가 공백이 커 제외.
//   - 거래대금(가격×거래량)이 최소 기준 미만 = 유동성 부족 → 제외.
// 거래량은 KIS 랭킹 요청에서 VOL_RANG='6'(1,000만 주 이상)으로 이미 1차 필터링되므로,
// 응답의 거래량 필드가 비어 있거나 파싱되지 않으면(필드명 변동 등) 서버 필터를 신뢰해 통과시킨다.
// 거래량이 유효한 양수로 들어왔을 때만 주 수·거래대금 기준을 적용한다(이중 필터가 전원 탈락시키지 않도록).
// 1차 필터를 통과한 상위 후보들을 등락률 순서대로 최대 limit개 돌려준다.
// 단기 흐름 필터(checkUsBuyCandidate)는 service가 분봉을 조회해 이 후보들에 순서대로 적용한다.
export function selectRankingCandidates(rankingList = [], {
  limit = US_RANK_CANDIDATE_LIMIT,
  maxFluctuationRate = US_MAX_FLUCTUATION_RATE,
  minTurnoverUsd = US_RANK_MIN_TURNOVER_USD
} = {}) {
  if (!Array.isArray(rankingList)) return [];
  const out = [];
  for (const item of rankingList) {
    if (!item || !item.symbol) continue;
    const rate = Number(item.fluctuationRate);
    if (!Number.isFinite(rate)) continue;
    if (Number.isFinite(maxFluctuationRate) && rate >= maxFluctuationRate) continue;
    const price = Number(item.price);
    if (!Number.isFinite(price) || price < US_RANK_MIN_PRICE) continue;
    const volume = Number(item.volume);
    if (Number.isFinite(volume) && volume > 0) {
      if (volume < US_RANK_MIN_VOLUME) continue;
      if (price * volume < minTurnoverUsd) continue;
    }
    out.push({
      symbol: String(item.symbol).trim().toUpperCase(),
      name: item.name || item.symbol,
      exchange: item.exchange || 'NAS',
      price,
      volume: Number.isFinite(volume) ? volume : 0,
      fluctuationRate: rate
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function selectRankingCandidate(rankingList = []) {
  return selectRankingCandidates(rankingList, { limit: 1 })[0] || null;
}

// 매수 후보의 당일 분봉으로 단기 흐름을 검사한다(국장 전략과 같은 규칙, 미국장은 가격제한폭 없음).
// 현재가가 최근 구간 시작가·VWAP 위에 있고, 거래량이 유지되며, 거래량 동반 장대 음봉이 없고,
// 직전 고점을 밀리지 않은 종목만 통과시켜 블로우오프 고점 추격을 줄인다.
// 순수 캔들 판정은 국장 엔진의 검증된 함수를 재사용한다(거래소만 다르고 규칙은 동일).
export function checkUsBuyCandidate(candles, opts = {}) {
  const minCandles = opts.minimumCandles ?? BUY_FILTER_DEFAULTS.minimumCandles;
  if (!Array.isArray(candles) || candles.length < minCandles) {
    return { ok: false, reason: '분봉 데이터가 부족해 단기 흐름을 확인할 수 없습니다.' };
  }
  const last = candles[candles.length - 1];
  const recentStart = Number(candles[0]?.open) || 0;
  const current = Number(last?.close) || 0;
  if (recentStart <= 0 || current <= 0) {
    return { ok: false, reason: '분봉 가격이 비어 있어 단기 흐름을 확인할 수 없습니다.' };
  }
  if (current <= recentStart) {
    return { ok: false, reason: `현재가 $${fmtUsd(current)}가 최근 구간 시작가 $${fmtUsd(recentStart)} 아래라 매수하지 않습니다.` };
  }
  const vwap = computeVwap(candles);
  if (vwap > 0 && current <= vwap) {
    return { ok: false, reason: `현재가 $${fmtUsd(current)}가 VWAP $${fmtUsd(vwap)} 아래라 매수하지 않습니다.` };
  }
  // 과열 회피: 현재가가 VWAP보다 과도하게 높으면(평균에서 너무 멀어짐) 되돌림 위험이 커 매수하지 않는다.
  // "VWAP 위"만 보면 급등 막판에도 참이라 꼭대기를 통과시키므로, 이탈 폭에 상한을 둔다.
  const maxVwapPremium = opts.maxVwapPremium ?? US_OVERHEAT_MAX_VWAP_PREMIUM;
  if (vwap > 0 && Number.isFinite(maxVwapPremium) && current > vwap * (1 + maxVwapPremium)) {
    return { ok: false, reason: `현재가 $${fmtUsd(current)}가 VWAP $${fmtUsd(vwap)} 대비 ${(maxVwapPremium * 100).toFixed(0)}% 넘게 높아(과열) 매수하지 않습니다.` };
  }
  if (isVolumeDecreasing(candles, opts.trendWindow, opts.volumeShrinkRatio)) {
    return { ok: false, reason: '최근 거래량이 직전 구간보다 크게 줄어 매수하지 않습니다.' };
  }
  if (findLargeBearishCandle(candles, opts)) {
    return { ok: false, reason: '거래량을 동반한 장대 음봉이 발생해 매수하지 않습니다.' };
  }
  if (isFailingHighBreakout(candles, opts)) {
    return { ok: false, reason: '직전 고점을 돌파하지 못하고 밀려 매수하지 않습니다.' };
  }
  return { ok: true, reason: null };
}

function fmtUsd(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 누적 손익률 = (실현손익 + 평가손익) / baseline.
//   - realizedProfitUsd: 이미 청산된 매매들의 누적 손익(USD).
//   - 평가손익(미실현): 현재 보유분 = 수량 × (현재가 - 평단).
// 과거에는 "현금(매수가능금액) + 보유 평가액 - baseline"으로 계산했으나, KIS 매수가능금액은
// 매수 직후 정산 지연으로 차감 전 값(≈매수 전 현금)이 잡혀 방금 산 보유분과 이중계산됐다.
// 그 결과 매수 다음 tick에 자산이 ~2배로 보여 누적 목표가 잘못 달성되고 손실 청산되는 사고가 있었다.
// 현금에 의존하지 않는 (실현+미실현) 손익 합으로 계산해 정산 지연에 영향받지 않게 한다.
// (정산이 정확할 때 두 식은 대수적으로 동일하다: cash = baseline + 실현손익 - 매수원가.)
export function computeCycleProfitRate({
  baselineUsd,
  realizedProfitUsd = 0,
  holdingQuantity = 0,
  currentPrice = 0,
  averagePrice = 0
}) {
  const baseline = Number(baselineUsd);
  if (!Number.isFinite(baseline) || baseline <= 0) return null;
  const realized = Number(realizedProfitUsd) || 0;
  const qty = Math.max(0, Number(holdingQuantity) || 0);
  const price = Number(currentPrice) || 0;
  const avg = Number(averagePrice) || 0;
  const unrealized = qty > 0 && price > 0 && avg > 0 ? qty * (price - avg) : 0;
  return (realized + unrealized) / baseline;
}

// 청산 지정가. 미국은 시장가가 없어, 호가를 가로지르는(현재가보다 낮은) 지정가로 매도해 체결을 보장한다.
// 미체결 재호가일수록(attempt↑) 더 깊게 내려 확실히 빠져나간다(최대 5%). 실제 체결은 그 가격이 아니라
// 그 가격 이상인 최우선 매수호가에서 이뤄지므로, 깊은 지정가가 곧 그만큼 싸게 파는 것을 뜻하지는 않는다.
export function aggressiveSellPrice(currentPrice, attempt = 0) {
  const price = Number(currentPrice) || 0;
  if (price <= 0) return price;
  const n = Math.max(0, Math.trunc(Number(attempt) || 0));
  const discount = Math.min(0.005 + 0.015 * n, 0.05);
  return price * (1 - discount);
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
