import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';
import {
  selectRankingCandidate,
  computeBuyQuantity,
  evaluateSell,
  resolveEntryWindow,
  parseHhmmMinutes,
  kstNowMinutes,
  makeKrRankIdempotencyKey,
  MAX_FLUCTUATION_RATE
} from '../src/services/krRankStrategyEngine.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const repo = await import('../src/repositories/krRankRepository.js');

const user = createUser(db, 'kr-rank@example.com');

test.after(() => tmp.cleanup());

// ── 등락률 25% 이상 제외 · 첫 종목 선택 ──────────────────────────────────

test('등락률 25% 이상 종목을 제외하고 남은 첫 종목을 선택한다', () => {
  const ranking = [
    { symbol: '000001', name: '과열', price: 1000, fluctuationRate: 0.28 },
    { symbol: '000002', name: '둘째', price: 2000, fluctuationRate: 0.22 },
    { symbol: '000003', name: '셋째', price: 3000, fluctuationRate: 0.15 }
  ];
  const picked = selectRankingCandidate(ranking, { maxFluctuationRate: MAX_FLUCTUATION_RATE });
  assert.equal(picked.symbol, '000002');
});

test('등락률 정확히 25%는 제외한다', () => {
  const ranking = [
    { symbol: '000001', name: '경계', price: 1000, fluctuationRate: 0.25 },
    { symbol: '000002', name: '통과', price: 2000, fluctuationRate: 0.249 }
  ];
  assert.equal(selectRankingCandidate(ranking).symbol, '000002');
});

test('모든 종목이 25% 이상이면 후보가 없다', () => {
  const ranking = [
    { symbol: '000001', name: 'a', price: 1000, fluctuationRate: 0.45 },
    { symbol: '000002', name: 'b', price: 2000, fluctuationRate: 0.27 }
  ];
  assert.equal(selectRankingCandidate(ranking), null);
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

const service = await import('../src/services/krRankService.js');

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
