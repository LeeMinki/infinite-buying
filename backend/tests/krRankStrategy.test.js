import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';
import {
  selectRankingCandidate,
  selectRankingCandidates,
  computeBuyQuantity,
  evaluateSell,
  resolveEntryWindow,
  resolveEntryObservationWindow,
  parseHhmmMinutes,
  kstNowMinutes,
  makeKrRankIdempotencyKey,
  computeVwap,
  computeTurnoverAmount,
  getCompletedMinuteCandles,
  isVolumeDecreasing,
  findLargeBearishCandle,
  isFailingHighBreakout,
  highPullbackRate,
  recentCloseRiseRate,
  scoreBuyCandidate,
  checkBuyCandidate,
  aggregateRankingCandidates,
  excludedKrRankIssueReason,
  evaluateEntryFailure,
  evaluateFastStopLoss,
  evaluateMidTradeDefense,
  evaluateStopLossDeferral,
  MAX_FLUCTUATION_RATE,
  maxFluctuationRateForEntryWindow
} from '../src/services/krRankStrategyEngine.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const repo = await import('../src/repositories/krRankRepository.js');
const service = await import('../src/services/krRankService.js');

const user = createUser(db, 'kr-rank@example.com');

test.after(() => tmp.cleanup());

// ── 등락률 21% 이상 제외 · 첫 종목 선택 ──────────────────────────────────

test('등락률 21% 이상 종목을 제외하고 남은 첫 종목을 선택한다', () => {
  const ranking = [
    { symbol: '000001', name: '과열', price: 1000, fluctuationRate: 0.25 },
    { symbol: '000002', name: '둘째', price: 2000, fluctuationRate: 0.205 },
    { symbol: '000003', name: '셋째', price: 3000, fluctuationRate: 0.15 }
  ];
  const picked = selectRankingCandidate(ranking, { maxFluctuationRate: MAX_FLUCTUATION_RATE });
  assert.equal(picked.symbol, '000002');
});

test('등락률 정확히 21%는 제외한다', () => {
  const ranking = [
    { symbol: '000001', name: '경계', price: 1000, fluctuationRate: 0.21 },
    { symbol: '000002', name: '통과', price: 2000, fluctuationRate: 0.209 }
  ];
  assert.equal(selectRankingCandidate(ranking).symbol, '000002');
});

test('모든 종목이 21% 이상이면 후보가 없다', () => {
  const ranking = [
    { symbol: '000001', name: 'a', price: 1000, fluctuationRate: 0.45 },
    { symbol: '000002', name: 'b', price: 2000, fluctuationRate: 0.21 }
  ];
  assert.equal(selectRankingCandidate(ranking), null);
});

test('진입 구간별 등락률 상한은 오전 21%, 점심은 되돌림 위험으로 16%를 쓴다', () => {
  assert.equal(maxFluctuationRateForEntryWindow('MORNING'), 0.21);
  assert.equal(maxFluctuationRateForEntryWindow('LUNCH'), 0.16);
  assert.equal(maxFluctuationRateForEntryWindow('UNKNOWN'), MAX_FLUCTUATION_RATE);
});

// ── 7.x 매수 수량 계산 ──────────────────────────────────────────────────

test('가용 현금을 최대한 사용한 정수 매수 수량을 계산한다', () => {
  assert.equal(computeBuyQuantity(105000, 10000), 10);
  assert.equal(computeBuyQuantity(9999, 10000), 0); // 1주도 못 사면 0
  assert.equal(computeBuyQuantity(0, 10000), 0);
});

test('진입 구간별 매수 금액 한도가 가용 현금보다 작으면 한도 기준으로 매수한다', () => {
  // 서비스는 computeBuyQuantity(min(진입 금액 한도, 가용 현금), 현재가)로 수량을 정한다.
  const entryBudget = 50_000;
  const cashAvailable = 1_000_000;
  const price = 10_000;
  assert.equal(computeBuyQuantity(Math.min(entryBudget, cashAvailable), price), 5);
  // 가용 현금이 한도보다 작으면 현금 기준으로 줄어든다.
  assert.equal(computeBuyQuantity(Math.min(entryBudget, 23_000), price), 2);
});

// ── 7.4 목표 수익 / 손절 매도 판단 · 사유 구분 ──────────────────────────

test('목표 수익률 도달 시 목표 수익 매도', () => {
  const sell = evaluateSell({ currentPrice: 10500, averagePrice: 10000, targetProfitRate: 0.05, stopLossRate: 0.03 });
  assert.equal(sell.decision, 'SELL');
  assert.equal(sell.sellReason, 'TARGET');
});

test('손절 기준 도달 시 손절 매도', () => {
  const sell = evaluateSell({ currentPrice: 9700, averagePrice: 10000, targetProfitRate: 0.05, stopLossRate: 0.03 });
  assert.equal(sell.decision, 'SELL');
  assert.equal(sell.sellReason, 'STOP_LOSS');
});

test('목표·손절 모두 미도달 시 보유 유지', () => {
  const sell = evaluateSell({ currentPrice: 10200, averagePrice: 10000, targetProfitRate: 0.05, stopLossRate: 0.03 });
  assert.equal(sell.decision, 'HOLD');
  assert.equal(sell.sellReason, null);
});

// ── 시각 청산 (TIME_LIQUIDATE) ───────────────────────────────────────────

test('청산 시각 도달 시 목표·손절 미도달이어도 시각 청산 매도', () => {
  // 14:30 청산 + 현재 14:30 KST + 수익률 +2% (목표 +5%·손절 -3% 모두 미도달)
  const sell = evaluateSell({
    currentPrice: 10200, averagePrice: 10000,
    targetProfitRate: 0.05, stopLossRate: 0.03,
    liquidateTime: '14:30', nowMinutes: 14 * 60 + 30
  });
  assert.equal(sell.decision, 'SELL');
  assert.equal(sell.sellReason, 'TIME_LIQUIDATE');
});

test('청산 시각 미도달이면 기존 동작대로 HOLD', () => {
  // 14:30 청산 + 현재 14:29 KST + 수익률 +2% → HOLD
  const sell = evaluateSell({
    currentPrice: 10200, averagePrice: 10000,
    targetProfitRate: 0.05, stopLossRate: 0.03,
    liquidateTime: '14:30', nowMinutes: 14 * 60 + 29
  });
  assert.equal(sell.decision, 'HOLD');
});

test('청산 시각 도달했어도 목표 수익이 먼저 발생하면 TARGET 우선', () => {
  // 14:30 청산 + 현재 15:00 KST + 수익률 +6% (목표 +5% 도달)
  const sell = evaluateSell({
    currentPrice: 10600, averagePrice: 10000,
    targetProfitRate: 0.05, stopLossRate: 0.03,
    liquidateTime: '14:30', nowMinutes: 15 * 60
  });
  assert.equal(sell.decision, 'SELL');
  assert.equal(sell.sellReason, 'TARGET');
});

test('청산 시각 도달했어도 손절이 먼저 발생하면 STOP_LOSS 우선', () => {
  // 14:30 청산 + 현재 15:00 KST + 수익률 -4% (손절 -3% 도달)
  const sell = evaluateSell({
    currentPrice: 9600, averagePrice: 10000,
    targetProfitRate: 0.05, stopLossRate: 0.03,
    liquidateTime: '14:30', nowMinutes: 15 * 60
  });
  assert.equal(sell.decision, 'SELL');
  assert.equal(sell.sellReason, 'STOP_LOSS');
});

test('청산 시각이 null이면 시각 청산을 적용하지 않는다', () => {
  const sell = evaluateSell({
    currentPrice: 10200, averagePrice: 10000,
    targetProfitRate: 0.05, stopLossRate: 0.03,
    liquidateTime: null, nowMinutes: 23 * 60
  });
  assert.equal(sell.decision, 'HOLD');
});

test("parseHhmmMinutes: 'HH:MM' 파싱과 잘못된 형식 거부", () => {
  assert.equal(parseHhmmMinutes('00:00'), 0);
  assert.equal(parseHhmmMinutes('14:30'), 14 * 60 + 30);
  assert.equal(parseHhmmMinutes('23:59'), 23 * 60 + 59);
  assert.equal(parseHhmmMinutes('9:05'), 9 * 60 + 5);
  assert.equal(parseHhmmMinutes('24:00'), null);
  assert.equal(parseHhmmMinutes('12:60'), null);
  assert.equal(parseHhmmMinutes('abc'), null);
  assert.equal(parseHhmmMinutes(''), null);
  assert.equal(parseHhmmMinutes(null), null);
});

test('kstNowMinutes는 0~1439 범위 정수를 반환한다', () => {
  const m = kstNowMinutes();
  assert.ok(Number.isInteger(m));
  assert.ok(m >= 0 && m < 1440);
});

// ── 진입 구간 판정 ──────────────────────────────────────────────────────

test('오전 09:10~10:00은 MORNING 진입 구간', () => {
  // 2026-05-18(월) 09:15 KST = 00:15 UTC
  assert.equal(resolveEntryWindow(new Date('2026-05-18T00:15:00Z'), { lunchEntryEnabled: false }), 'MORNING');
});

test('점심 11:30 진입은 lunchEntryEnabled가 켜져 있을 때만', () => {
  const lunch = new Date('2026-05-18T02:35:00Z'); // 11:35 KST
  assert.equal(resolveEntryWindow(lunch, { lunchEntryEnabled: false }), null);
  assert.equal(resolveEntryWindow(lunch, { lunchEntryEnabled: true }), 'LUNCH');
});

test('진입 구간 밖이면 null, 주말이면 null', () => {
  assert.equal(resolveEntryWindow(new Date('2026-05-18T05:00:00Z'), { lunchEntryEnabled: true }), null); // 14:00 KST
  assert.equal(resolveEntryWindow(new Date('2026-05-16T00:15:00Z'), { lunchEntryEnabled: true }), null); // 토요일
});

// ── 7.3 멱등키 ──────────────────────────────────────────────────────────

test('멱등키는 날짜·전략·구간·방향으로 만들어지고 서로 구분된다', () => {
  const buy = makeKrRankIdempotencyKey({ tradeDate: '2026-05-18', strategyId: 7, entryWindow: 'MORNING', side: 'BUY' });
  const sell = makeKrRankIdempotencyKey({ tradeDate: '2026-05-18', strategyId: 7, entryWindow: 'MORNING', side: 'SELL' });
  const lunch = makeKrRankIdempotencyKey({ tradeDate: '2026-05-18', strategyId: 7, entryWindow: 'LUNCH', side: 'BUY' });
  assert.equal(buy, '20260518-7-MORNING-BUY');
  assert.notEqual(buy, sell);
  assert.notEqual(buy, lunch);
});

// ── 7.2 진입 구간당 매수 1회 (매도 후 재매수 금지) ──────────────────────

test('같은 날짜·진입 구간에 진입 기록은 한 번만 만들어진다', () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000, lunchBudget: 0,
    morningTargetProfitRate: 0.05, morningStopLossRate: 0.03,
    lunchEntryEnabled: false, lunchTargetProfitRate: 0.05, lunchStopLossRate: 0.03
  });
  const first = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-05-18', entryWindow: 'MORNING',
    status: 'BOUGHT', selectedSymbol: '000002', bought: true
  });
  assert.ok(first);
  // 매도 후 같은 구간 재진입 시도 → UNIQUE 위반 → null (재매수 차단)
  const second = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-05-18', entryWindow: 'MORNING',
    status: 'SELECTED', selectedSymbol: '000009', bought: false
  });
  assert.equal(second, null);
  // 점심 구간은 별도로 진입 가능
  const lunch = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-05-18', entryWindow: 'LUNCH',
    status: 'SELECTED', selectedSymbol: '000003', bought: false
  });
  assert.ok(lunch);
});

// ── 7.3 멱등키 중복 차단 · 7.5 실주문 OFF 기록 ──────────────────────────

// ── 전 재산 자동 매수 (autoBudgetEnabled) ───────────────────────────────

test('autoBudgetEnabled=true 전략은 morning/lunch budget을 0으로 저장하고 반환한다', () => {
  const created = repo.createStrategy(user.id, {
    autoBudgetEnabled: true,
    morningBudget: 0,
    morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
    lunchEntryEnabled: true, lunchBudget: 0,
    lunchTargetProfitRate: 0.02, lunchStopLossRate: 0.05
  });
  assert.equal(created.autoBudgetEnabled, true);
  assert.equal(created.morningBudget, 0);
  assert.equal(created.lunchBudget, 0);
});

test('autoBudgetEnabled=false 전략은 morning budget > 0 제약을 강제한다', () => {
  assert.throws(() => repo.createStrategy(user.id, {
    autoBudgetEnabled: false,
    morningBudget: 0,
    morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
    lunchEntryEnabled: false, lunchBudget: 0,
    lunchTargetProfitRate: 0.02, lunchStopLossRate: 0.05
  }), /CHECK constraint/);
});

test('autoBudgetEnabled=false 전략은 lunch 진입 켜고 lunch budget = 0이면 거절된다', () => {
  assert.throws(() => repo.createStrategy(user.id, {
    autoBudgetEnabled: false,
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
    lunchEntryEnabled: true, lunchBudget: 0,
    lunchTargetProfitRate: 0.02, lunchStopLossRate: 0.05
  }), /CHECK constraint/);
});

// ── 청산 시각 검증 (진입 시각 이전 footgun 차단) ─────────────────────────

test('오전 청산 시각이 09:10 이전이면 거절', async () => {
  await assert.rejects(
    async () => service.createStrategy(user.id, {
      morningBudget: 1_000_000,
      morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
      morningLiquidateTime: '09:00',
      lunchEntryEnabled: false
    }),
    /오전 청산 시각.*이후여야/
  );
});

test('오전 청산 시각이 09:10 정확이면 거절(즉시 청산 방지)', async () => {
  await assert.rejects(
    async () => service.createStrategy(user.id, {
      morningBudget: 1_000_000,
      morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
      morningLiquidateTime: '09:10',
      lunchEntryEnabled: false
    }),
    /오전 청산 시각.*이후여야/
  );
});

test('오전 청산 시각이 09:11 이후면 허용', () => {
  const created = service.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
    morningLiquidateTime: '09:11',
    lunchEntryEnabled: false
  });
  assert.equal(created.morningLiquidateTime, '09:11');
});

test('점심 청산 시각이 11:30 이전이면 거절', async () => {
  await assert.rejects(
    async () => service.createStrategy(user.id, {
      morningBudget: 1_000_000,
      morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
      lunchEntryEnabled: true, lunchBudget: 1_000_000,
      lunchTargetProfitRate: 0.02, lunchStopLossRate: 0.05,
      lunchLiquidateTime: '11:00'
    }),
    /점심 청산 시각.*이후여야/
  );
});

test('점심 청산 시각이 11:31 이상이면 허용', () => {
  const created = service.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
    lunchEntryEnabled: true, lunchBudget: 1_000_000,
    lunchTargetProfitRate: 0.02, lunchStopLossRate: 0.05,
    lunchLiquidateTime: '12:30'
  });
  assert.equal(created.lunchLiquidateTime, '12:30');
});

test('청산 시각이 비어 있으면 검증 통과(시각 청산 미적용)', () => {
  const created = service.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
    lunchEntryEnabled: false
  });
  assert.equal(created.morningLiquidateTime, null);
});

test('같은 멱등키 주문은 중복으로 감지된다 (DRY_RUN 기록도 동일)', () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000, lunchBudget: 0,
    morningTargetProfitRate: 0.05, morningStopLossRate: 0.03,
    lunchEntryEnabled: false, lunchTargetProfitRate: 0.05, lunchStopLossRate: 0.03
  });
  const key = makeKrRankIdempotencyKey({ tradeDate: '2026-05-18', strategyId: strategy.id, entryWindow: 'MORNING', side: 'BUY' });
  assert.equal(repo.hasDuplicateOrder(key), false);
  // 실주문 OFF → DRY_RUN 상태로 주문 예정 기록 저장
  const order = repo.createOrder(user.id, {
    strategyId: strategy.id, symbol: '000002', side: 'BUY', entryWindow: 'MORNING',
    quantity: 10, orderPrice: 2000, estimatedAmount: 20000,
    idempotencyKey: key, decisionReason: '오전 진입', status: 'DRY_RUN', liveOrderEnabled: false
  });
  assert.equal(order.status, 'DRY_RUN');
  assert.equal(order.liveOrderEnabled, false);
  // 같은 키 재사용 → 중복 감지
  assert.equal(repo.hasDuplicateOrder(key), true);
});

// ── 매수 필터: 단기 흐름 검사 헬퍼 ────────────────────────────────────────

function candle(time, open, high, low, close, volume) {
  return { time, open, high, low, close, volume: volume === 0 ? 0 : volume * 1_000_000 };
}

test('selectRankingCandidates는 상한 미만 후보를 순서대로 반환한다', () => {
  const ranking = [
    { symbol: 'A', price: 100, fluctuationRate: 0.25 }, // 상한 초과 제외
    { symbol: 'B', price: 200, fluctuationRate: 0.18 },
    { symbol: 'C', price: 300, fluctuationRate: 0.12 }
  ];
  const list = selectRankingCandidates(ranking);
  assert.deepEqual(list.map((c) => c.symbol), ['B', 'C']);
});

test('selectRankingCandidates는 우선주와 상장지수·파생형 상품을 제외한다', () => {
  const ranking = [
    { symbol: '006345', name: '대원전선우', price: 12240, fluctuationRate: 0.12 },
    { symbol: '460860', name: 'KIWOOM 2차전지산업레버리지', price: 11000, fluctuationRate: 0.11 },
    { symbol: '999999', name: '미래스팩12호', price: 2100, fluctuationRate: 0.10 },
    { symbol: '000660', name: 'SK하이닉스', price: 180000, fluctuationRate: 0.09 }
  ];
  assert.match(excludedKrRankIssueReason(ranking[0]), /우선주/);
  assert.match(excludedKrRankIssueReason(ranking[1]), /상품/);
  assert.deepEqual(selectRankingCandidates(ranking).map((c) => c.symbol), ['000660']);
});

test('resolveEntryObservationWindow: 09:00~09:10, 11:20~11:30 관찰 구간을 판정한다', () => {
  assert.equal(resolveEntryObservationWindow(new Date('2026-05-18T00:05:00Z'), { lunchEntryEnabled: false }), 'MORNING');
  assert.equal(resolveEntryObservationWindow(new Date('2026-05-18T00:10:00Z'), { lunchEntryEnabled: false }), null);
  assert.equal(resolveEntryObservationWindow(new Date('2026-05-18T02:25:00Z'), { lunchEntryEnabled: false }), null);
  assert.equal(resolveEntryObservationWindow(new Date('2026-05-18T02:25:00Z'), { lunchEntryEnabled: true }), 'LUNCH');
  assert.equal(resolveEntryObservationWindow(new Date('2026-05-18T02:30:00Z'), { lunchEntryEnabled: true }), null);
});

test('aggregateRankingCandidates: 반복 관찰된 후보를 우선한다', () => {
  const snapshots = [
    [
      { symbol: 'AAA', name: '일회성', price: 1000, fluctuationRate: 0.18 },
      { symbol: 'BBB', name: '지속', price: 2000, fluctuationRate: 0.12 }
    ],
    [
      { symbol: 'CCC', name: '교체', price: 1500, fluctuationRate: 0.16 },
      { symbol: 'BBB', name: '지속', price: 2100, fluctuationRate: 0.13 }
    ],
    [
      { symbol: 'BBB', name: '지속', price: 2200, fluctuationRate: 0.14 },
      { symbol: 'DDD', name: '후발', price: 3000, fluctuationRate: 0.10 }
    ]
  ];
  const candidates = aggregateRankingCandidates(snapshots, { maxFluctuationRate: 0.21, candidateLimit: 5 });
  assert.equal(candidates[0].symbol, 'BBB');
  assert.equal(candidates.some((c) => c.symbol === 'AAA'), false);
  assert.equal(candidates[0].observationCount, 3);
});

test('VWAP은 (고+저+종)/3 가중 평균으로 계산된다', () => {
  const candles = [
    candle('090100', 100, 105, 99, 102, 1000),
    candle('090200', 102, 108, 101, 107, 2000)
  ];
  const expected = ((105 + 99 + 102) / 3 * 1000 + (108 + 101 + 107) / 3 * 2000) / 3000;
  const vwap = computeVwap(candles);
  assert.ok(Math.abs(vwap - expected) < 0.0001, `vwap=${vwap} expected=${expected}`);
});

test('거래대금은 종가×거래량 합으로 계산한다', () => {
  const turnover = computeTurnoverAmount([
    { close: 1000, volume: 10 },
    { close: 1200, volume: 20 }
  ]);
  assert.equal(turnover, 34_000);
});

test('거래량이 직전 구간 대비 크게 줄면 감소 추세로 본다', () => {
  const candles = [
    candle('090100', 100, 101, 99, 100, 1000),
    candle('090200', 100, 101, 99, 100, 1000),
    candle('090300', 100, 101, 99, 100, 1000),
    candle('090400', 100, 101, 99, 100, 100),
    candle('090500', 100, 101, 99, 100, 100),
    candle('090600', 100, 101, 99, 100, 100)
  ];
  // 직전 3봉 합 300, 그 이전 3봉 합 3000 → 비율 0.1 < 0.5 → DECREASING
  assert.equal(isVolumeDecreasing(candles), true);
});

test('거래량 동반 장대 음봉은 거절 사유로 잡힌다', () => {
  const candles = [
    candle('090100', 100, 102, 99, 101, 1000),
    candle('090200', 101, 103, 100, 102, 1000),
    candle('090300', 102, 102, 96, 96, 3000) // 약 -5.9% 음봉 + 거래량 3배
  ];
  const bearish = findLargeBearishCandle(candles);
  assert.ok(bearish, '장대 음봉이 검출되어야 한다');
  assert.equal(bearish.time, '090300');
});

test('직전 고점 돌파 흐름이 크게 깨진 마지막 봉은 거절', () => {
  const candles = [
    candle('090100', 100, 110, 99, 108, 1000),
    candle('090200', 108, 115, 107, 110, 1000),
    candle('090300', 110, 112, 100, 100, 1000) // 직전 고점 115 대비 종가 100
  ];
  assert.equal(isFailingHighBreakout(candles), true);
});

test('checkBuyCandidate: 시가 위 + VWAP 위 + 거래량 유지 + 고점 갱신이면 통과', () => {
  // 우상향 패턴 — 시가 100에서 점점 오르며 거래량도 일정 이상 유지.
  const candles = [
    candle('090100', 100, 101, 100, 101, 1000),
    candle('090200', 101, 102, 100, 102, 1000),
    candle('090300', 102, 103, 101, 103, 1000),
    candle('090400', 103, 104, 102, 104, 1100),
    candle('090500', 104, 105, 103, 105, 1200),
    candle('090600', 105, 106, 104, 106, 1300)
  ];
  const result = checkBuyCandidate(candles, { useCompletedCandles: false });
  assert.equal(result.ok, true, `필터 통과해야 하는데 거절: ${result.reason}`);
});

test('checkBuyCandidate: 가장 최근 완성봉 거래량이 0이면 거절(유령 분봉 추격 방지)', () => {
  // 우상향 흐름이지만 마지막 완성봉에 실제 체결이 없다(거래량 0) → 한빛소프트형 슬리피지 사고 방지.
  const candles = [
    candle('090100', 100, 101, 100, 101, 1000),
    candle('090200', 101, 102, 100, 102, 1000),
    candle('090300', 102, 103, 101, 103, 1000),
    candle('090400', 103, 104, 102, 104, 1100),
    candle('090500', 104, 105, 103, 105, 1200),
    candle('090600', 105, 106, 104, 106, 0)
  ];
  const result = checkBuyCandidate(candles, { useCompletedCandles: false });
  assert.equal(result.ok, false);
  assert.match(result.reason, /거래량이 0/);
});

test('checkBuyCandidate: 관찰 구간 거래대금이 부족하면 저유동성으로 거절한다', () => {
  const candles = [
    { time: '090100', open: 1000, high: 1010, low: 1000, close: 1010, volume: 1000 },
    { time: '090200', open: 1010, high: 1020, low: 1005, close: 1020, volume: 1000 },
    { time: '090300', open: 1020, high: 1030, low: 1010, close: 1030, volume: 1000 },
    { time: '090400', open: 1030, high: 1040, low: 1020, close: 1040, volume: 1000 }
  ];
  const result = checkBuyCandidate(candles, { useCompletedCandles: false });
  assert.equal(result.ok, false);
  assert.match(result.reason, /거래대금|저유동성/);
});

test('checkBuyCandidate: 통과 시 신호가(referencePrice)로 마지막 완성봉 종가를 돌려준다', () => {
  const candles = [
    candle('090100', 100, 101, 100, 101, 1000),
    candle('090200', 101, 102, 100, 102, 1000),
    candle('090300', 102, 103, 101, 103, 1000),
    candle('090400', 103, 104, 102, 104, 1100),
    candle('090500', 104, 105, 103, 105, 1200),
    candle('090600', 105, 106, 104, 106, 1300)
  ];
  const result = checkBuyCandidate(candles, { useCompletedCandles: false });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.referencePrice, 106);
});

test('checkBuyCandidate: 현재가가 시가 아래면 거절', () => {
  const candles = [
    candle('090100', 100, 105, 95, 95, 1000),
    candle('090200', 95, 96, 92, 93, 1000),
    candle('090300', 93, 94, 90, 92, 1000)
  ];
  const result = checkBuyCandidate(candles, { useCompletedCandles: false });
  assert.equal(result.ok, false);
  assert.ok(/시가/.test(result.reason));
});

test('checkBuyCandidate: 데이터 부족이면 보수적으로 거절', () => {
  assert.equal(checkBuyCandidate([], { useCompletedCandles: false }).ok, false);
  assert.equal(checkBuyCandidate([candle('090100', 100, 101, 99, 100, 1000)], { useCompletedCandles: false }).ok, false);
});

test('getCompletedMinuteCandles: 현재 진행 중인 마지막 분봉은 진입 판단에서 제외한다', () => {
  const candles = [
    candle('090800', 100, 102, 99, 101, 1000),
    candle('090900', 101, 103, 100, 102, 1000),
    candle('091000', 102, 120, 101, 119, 3000)
  ];
  const completed = getCompletedMinuteCandles(candles, { nowHms: '091008' });
  assert.deepEqual(completed.map((c) => c.time), ['090800', '090900']);
});

test('checkBuyCandidate: VWAP 바로 위라 이격이 부족하면 거절한다', () => {
  const candles = [
    candle('090100', 100, 101, 99, 100, 1000),
    candle('090200', 100, 101, 99, 100, 1000),
    candle('090300', 100, 101, 99, 100.1, 1000)
  ];
  const result = checkBuyCandidate(candles, { useCompletedCandles: false });
  assert.equal(result.ok, false);
  assert.match(result.reason, /VWAP/);
});

test('checkBuyCandidate: VWAP 대비 과열이면 거절한다', () => {
  const candles = [
    candle('090100', 100, 101, 99, 100, 5000),
    candle('090200', 100, 102, 99, 101, 5000),
    candle('090300', 101, 111, 101, 110, 1000)
  ];
  const result = checkBuyCandidate(candles, {
    useCompletedCandles: false,
    maxVwapPremiumRate: 0.05,
    rapidRiseMaxRate: 0.50
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /과열/);
});

test('checkBuyCandidate: 점심 진입은 최근 VWAP 대비 과열도 거절한다', () => {
  const candles = [
    candle('112100', 100, 101, 99, 100, 1000),
    candle('112200', 100, 101, 99, 100, 1000),
    candle('112300', 100, 101, 99, 101, 1000),
    candle('112400', 101, 102, 100, 102, 1000),
    candle('112500', 102, 103, 101, 103, 1000),
    candle('112600', 103, 108, 103, 108, 1000)
  ];
  const result = checkBuyCandidate(candles, {
    useCompletedCandles: false,
    entryWindow: 'LUNCH',
    maxVwapPremiumRate: 0.50,
    lunchRecentVwapWindow: 3,
    lunchRecentVwapMaxPremiumRate: 0.03,
    rapidRiseMaxRate: 0.50
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /최근 VWAP.*과열/);
});

test('checkBuyCandidate: 최근 3분 또는 8분 수직 급등 후보는 거절한다', () => {
  const rapidCandles = [
    candle('090100', 100, 101, 99, 100, 1000),
    candle('090200', 100, 101, 99, 101, 1000),
    candle('090300', 101, 102, 100, 102, 1000),
    candle('090400', 102, 105, 102, 105, 1200),
    candle('090500', 105, 106, 104, 106, 1200),
    candle('090600', 106, 107, 105, 107, 1200)
  ];
  assert.ok(recentCloseRiseRate(rapidCandles, 3) >= 0.04);
  const rapidResult = checkBuyCandidate(rapidCandles, {
    useCompletedCandles: false,
    maxVwapPremiumRate: 0.50
  });
  assert.equal(rapidResult.ok, false);
  assert.match(rapidResult.reason, /최근 3분/);

  const extendedCandles = [
    candle('090100', 100, 101, 99, 100, 1000),
    candle('090200', 100, 101, 99, 100.5, 1000),
    candle('090300', 100.5, 101, 100, 101, 1000),
    candle('090400', 101, 102, 100, 101.5, 1000),
    candle('090500', 101.5, 103, 101, 102.5, 1000),
    candle('090600', 102.5, 104, 102, 103.5, 1100),
    candle('090700', 103.5, 105, 103, 104.5, 1100),
    candle('090800', 104.5, 106, 104, 106, 1200),
    candle('090900', 106, 108, 106, 108, 1200)
  ];
  assert.ok(recentCloseRiseRate(extendedCandles, 8) >= 0.07);
  const extendedResult = checkBuyCandidate(extendedCandles, {
    useCompletedCandles: false,
    maxVwapPremiumRate: 0.50,
    rapidRiseMaxRate: 0.50
  });
  assert.equal(extendedResult.ok, false);
  assert.match(extendedResult.reason, /최근 8분/);
});

test('checkBuyCandidate: 최근 고점 대비 1.2% 이상 밀리면 거절한다', () => {
  const candles = [
    candle('090100', 100, 102, 99, 101, 1000),
    candle('090200', 101, 110, 100, 109, 1000),
    candle('090300', 109, 109, 106, 108, 1000)
  ];
  assert.ok(highPullbackRate(candles) >= 0.012);
  const result = checkBuyCandidate(candles, { useCompletedCandles: false });
  assert.equal(result.ok, false);
  assert.match(result.reason, /고점/);
});

test('scoreBuyCandidate: VWAP 이격이 좋고 덜 밀린 후보를 더 높게 평가한다', () => {
  const strong = [
    candle('090100', 100, 101, 99, 101, 1000),
    candle('090200', 101, 103, 100, 103, 1200),
    candle('090300', 103, 106, 102, 106, 1500)
  ];
  const weak = [
    candle('090100', 100, 105, 99, 104, 1000),
    candle('090200', 104, 106, 103, 105, 1000),
    candle('090300', 105, 106, 103, 104.5, 900)
  ];
  assert.ok(
    scoreBuyCandidate(strong, { fluctuationRate: 0.09 }) > scoreBuyCandidate(weak, { fluctuationRate: 0.09 })
  );
});

test('evaluateEntryFailure: VWAP 아래 연속 + 스윙 저점(지지) 이탈이면 흐름 이탈로 본다', () => {
  const candles = [
    candle('091000', 100, 103, 100, 102, 1000),
    candle('091100', 102, 105, 101, 104, 1200),
    candle('091200', 104, 104, 100, 100, 1400), // VWAP 아래 종가
    candle('091300', 100, 100, 97, 97, 1600)    // 연속 하회 + 지지(스윙 저점 100) 이탈
  ];
  const result = evaluateEntryFailure(candles);
  assert.equal(result.failed, true);
  assert.match(result.reason, /VWAP|지지|스윙/);
});

test('evaluateEntryFailure (확인): 마지막 봉이 직전 종가를 회복하면(흔들기 반등) 손절하지 않는다', () => {
  // 엠케이전자 09:41형: 한 봉 아래꼬리 후 같은 봉/다음 봉이 종가를 끌어올린 경우.
  const candles = [
    candle('091000', 100, 103, 100, 102, 1000),
    candle('091100', 102, 105, 101, 104, 1200),
    candle('091200', 104, 104, 100, 100, 1400), // 눌림
    candle('091300', 100, 103, 100, 103, 1600)  // 직전 종가 100 회복 → 반등
  ];
  assert.equal(evaluateEntryFailure(candles).failed, false);
});

test('evaluateEntryFailure (확인): 단일 봉만 VWAP 아래면(연속 미충족) 손절하지 않는다', () => {
  const candles = [
    candle('091000', 100, 103, 100, 102, 1000),
    candle('091100', 102, 105, 101, 104, 1200), // VWAP 위
    candle('091200', 104, 104, 99, 99, 1400)    // 마지막 봉만 VWAP 아래
  ];
  assert.equal(evaluateEntryFailure(candles).failed, false);
});

test('evaluateFastStopLoss (ATR 적응형): 변동성 큰 종목의 -3.5%는 손절하지 않는다', () => {
  // 엠케이전자형: 분봉 범위가 큰 종목은 -3.5% 정도는 노이즈라 빠른손절 트리거 미달.
  const volatile = [
    candle('093900', 24750, 24800, 24450, 24600, 3000),
    candle('094000', 24600, 24800, 24400, 24450, 4000),
    candle('094100', 24450, 24650, 24300, 24450, 5000)
  ];
  assert.equal(evaluateFastStopLoss(volatile, { profitRate: -0.035 }).failed, false);
});

test('evaluateFastStopLoss (ATR 적응형): 변동성 작은 종목의 -2.5% 붕괴는 손절한다', () => {
  const calm = [
    candle('091000', 5600, 5610, 5595, 5605, 1000),
    candle('091100', 5605, 5610, 5590, 5595, 1200),
    candle('091200', 5595, 5600, 5570, 5575, 1400), // VWAP 아래
    candle('091300', 5575, 5580, 5550, 5555, 1600)  // 연속 하회 + 지지(5570) 이탈
  ];
  assert.equal(evaluateFastStopLoss(calm, { profitRate: -0.005 }).failed, false); // 손실 하한 미달
  assert.equal(evaluateFastStopLoss(calm, { profitRate: -0.025 }).failed, true);
});

test('evaluateFastStopLoss (완성봉): useCompletedCandles면 마지막(진행 중) 봉을 빼고 판단한다', () => {
  // 091000~091300 붕괴 뒤, 진행 중 마지막 봉(091400)이 강하게 반등(직전 종가 회복)한 상태.
  const candles = [
    candle('091000', 5600, 5610, 5595, 5605, 1000),
    candle('091100', 5605, 5610, 5590, 5595, 1200),
    candle('091200', 5595, 5600, 5570, 5575, 1400),
    candle('091300', 5575, 5580, 5550, 5555, 1600), // 여기까지 붕괴 확정
    candle('091400', 5555, 5620, 5555, 5615, 2000)  // 진행 중 봉: 강한 반등(직전 5555 회복)
  ];
  // 진행 중 반등 봉을 포함하면 '반등 중'이라 미발동, 빼면 091300까지의 붕괴로 발동.
  assert.equal(evaluateFastStopLoss(candles, { profitRate: -0.025 }).failed, false);
  assert.equal(evaluateFastStopLoss(candles, { profitRate: -0.025, useCompletedCandles: true }).failed, true);
});

test('evaluateFastStopLoss: 매수 후 20분이 지나면 진입 실패 빠른손절을 하지 않는다', () => {
  const candles = [
    candle('123200', 5600, 5600, 5580, 5600, 1000),
    candle('130100', 5560, 5560, 5520, 5550, 9799),
    candle('130200', 5520, 5520, 5520, 5520, 191),
    candle('130400', 5520, 5520, 5500, 5500, 2801),
    candle('130500', 5500, 5500, 5480, 5490, 489)
  ];

  assert.equal(evaluateFastStopLoss(candles, {
    profitRate: -0.0214,
    holdingMinutes: 95,
    highPullbackRate: 0.018,
    openBreakRate: 0.008
  }).failed, false);
  assert.equal(evaluateFastStopLoss(candles, {
    profitRate: -0.0214,
    holdingMinutes: 15,
    highPullbackRate: 0.018,
    openBreakRate: 0.008
  }).failed, true);
});

test('evaluateStopLossDeferral: 매수 직후 손절선 터치는 초기 흔들기로 보고 유예한다', () => {
  const vcLike = [
    candle('090000', 2360, 2410, 2360, 2410, 893),
    candle('090100', 2425, 2580, 2425, 2580, 2919),
    candle('091000', 2540, 2600, 2530, 2575, 2638),
    candle('091100', 2565, 2575, 2560, 2575, 126),
    candle('091200', 2575, 2575, 2415, 2420, 960)
  ];
  const result = evaluateStopLossDeferral(vcLike, {
    profitRate: -0.0613,
    stopLossRate: 0.05,
    holdingMinutes: 1
  });
  assert.equal(result.defer, true);
  assert.match(result.reason, /초기 흔들기|확인/);
});

test('evaluateStopLossDeferral: 관찰 한도를 넘는 급락은 유예하지 않는다', () => {
  const candles = [
    candle('091000', 100, 101, 99, 100, 1000),
    candle('091100', 100, 101, 95, 96, 1200),
    candle('091200', 96, 96, 90, 91, 2000)
  ];
  const result = evaluateStopLossDeferral(candles, {
    profitRate: -0.105,
    stopLossRate: 0.05,
    holdingMinutes: 2
  });
  assert.equal(result.defer, false);
  assert.match(result.reason, /한도/);
});

test('evaluateStopLossDeferral: 관찰 시간이 지난 뒤 구조 붕괴가 확인되면 유예하지 않는다', () => {
  const broken = [
    candle('091000', 100, 104, 99, 103, 5000),
    candle('091100', 103, 104, 101, 102, 5000),
    candle('091200', 96, 97, 94, 95, 2000),
    candle('091300', 95, 95, 92, 93, 2200),
    candle('091400', 93, 93, 89, 90, 2400)
  ];
  const result = evaluateStopLossDeferral(broken, {
    profitRate: -0.06,
    stopLossRate: 0.05,
    holdingMinutes: 7
  });
  assert.equal(result.defer, false);
});

test('evaluateStopLossDeferral: 직전 분봉이 ATR을 크게 넘는 칼낙이면 시간·구조와 무관하게 손절한다', () => {
  // 잔잔하던 흐름(저변동성) 뒤 한 봉에서 -6% 칼낙 → 유예하지 않는다.
  const knife = [
    candle('091000', 1000, 1002, 999, 1001, 1000),
    candle('091100', 1001, 1003, 1000, 1002, 1100),
    candle('091200', 1002, 1003, 1001, 1002, 900),
    candle('091300', 1002, 1003, 1000, 1001, 1200),
    candle('091400', 1001, 1001, 940, 942, 3000)
  ];
  const result = evaluateStopLossDeferral(knife, {
    profitRate: -0.055,
    stopLossRate: 0.05,
    holdingMinutes: 1
  });
  assert.equal(result.defer, false);
  assert.match(result.reason, /칼낙/);
});

test('evaluateStopLossDeferral: 하락봉 거래량이 상승봉을 크게 웃도는 분출 매도면 손절한다', () => {
  // 하락은 완만(칼낙 아님)하지만 하락봉 거래량이 상승봉 평균의 2배 이상 → 분출 매도로 손절.
  const distribution = [
    candle('091000', 1000, 1006, 999, 1005, 1000),
    candle('091100', 1005, 1010, 1004, 1009, 1100),
    candle('091200', 1009, 1010, 1000, 1001, 9000),
    candle('091300', 1001, 1002, 994, 995, 9500)
  ];
  const result = evaluateStopLossDeferral(distribution, {
    profitRate: -0.055,
    stopLossRate: 0.05,
    holdingMinutes: 1
  });
  assert.equal(result.defer, false);
  assert.match(result.reason, /분출 매도/);
});

test('evaluateMidTradeDefense: 오래 미체결된 목표 주문이 VWAP 아래 약세로 굳으면 방어 손절한다', () => {
  const candles = [
    candle('113000', 100, 103, 99, 102, 1200),
    candle('113100', 102, 104, 101, 103, 1300),
    candle('113200', 103, 104, 102, 103, 1200),
    candle('113300', 103, 103, 100, 101, 1000),
    candle('113400', 101, 102, 99, 100, 900),
    candle('113500', 100, 101, 98, 99, 800),
    candle('113600', 99, 100, 97, 98, 700),
    candle('113700', 98, 99, 96, 97, 600),
    candle('113800', 97, 98, 95, 96, 500),
    candle('113900', 96, 97, 94, 95, 400),
    candle('114000', 95, 96, 93, 94, 300)
  ];
  const result = evaluateMidTradeDefense(candles, {
    profitRate: -0.035,
    holdingMinutes: 70,
    targetOrderAgeMinutes: 70
  });
  assert.equal(result.defensive, true);
  assert.match(result.reason, /목표가 주문/);
});

test('evaluateMidTradeDefense: 목표 주문이 오래되지 않았거나 손실이 작으면 방어 손절하지 않는다', () => {
  const candles = [
    candle('113000', 100, 103, 99, 102, 1200),
    candle('113100', 102, 103, 100, 101, 1100),
    candle('113200', 101, 102, 98, 99, 900),
    candle('113300', 99, 100, 97, 98, 800),
    candle('113400', 98, 99, 96, 97, 700),
    candle('113500', 97, 98, 95, 96, 600)
  ];
  assert.equal(evaluateMidTradeDefense(candles, {
    profitRate: -0.035,
    holdingMinutes: 30,
    targetOrderAgeMinutes: 30
  }).defensive, false);
  assert.equal(evaluateMidTradeDefense(candles, {
    profitRate: -0.015,
    holdingMinutes: 70,
    targetOrderAgeMinutes: 70
  }).defensive, false);
});

// ── 진입 기록 승격: 레거시 NO_CANDIDATE → SELECTED ──────────────────────
test('updateEntrySelection은 NO_CANDIDATE 진입 기록을 SELECTED로 승격한다', () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000, lunchBudget: 0,
    morningTargetProfitRate: 0.05, morningStopLossRate: 0.03,
    lunchEntryEnabled: false, lunchTargetProfitRate: 0.05, lunchStopLossRate: 0.03
  });
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-05-25', entryWindow: 'MORNING',
    status: 'NO_CANDIDATE', bought: false
  });
  assert.equal(entry.status, 'NO_CANDIDATE');
  assert.equal(entry.selectedSymbol, null);
  const promoted = repo.updateEntrySelection(entry.id, {
    selectedSymbol: '000660', selectedSymbolName: 'SK하이닉스',
    selectedPrice: 180000, selectedFluctuationRate: 0.12
  });
  assert.equal(promoted.status, 'SELECTED');
  assert.equal(promoted.selectedSymbol, '000660');
  assert.equal(promoted.bought, false);
});
