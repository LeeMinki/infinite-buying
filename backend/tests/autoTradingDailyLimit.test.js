import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

// 서비스 모듈은 useTempDb() 이후에 동적 import 한다. 정적 import는 config/env.js를
// 먼저 평가시켜 DB_PATH가 임시 DB로 바뀌기 전 값으로 굳어 dev DB를 건드릴 수 있다.
const tmp = useTempDb();
const db = await bootstrapDb();
const repo = await import('../src/repositories/autoTradingRepository.js');
const { roundOverseasOrderPrice } = await import('../src/services/kisTradingService.js');

const user = createUser(db, 'daily-limit@example.com');

test.after(() => tmp.cleanup());

function makeStrategy() {
  return repo.createStrategy(user.id, {
    symbol: 'TQQQ', symbolName: 'TQQQ', market: 'US', currency: 'USD', exchange: 'NAS',
    totalBudget: 4000, splitCount: 40, buyAmountPerRound: 100,
    targetProfitRate: 0.1, bigBuyPremiumRate: null
  });
}

function makeOrder(strategyId, { side, status, key }) {
  return repo.createOrder(user.id, {
    strategyId, symbol: 'TQQQ', market: 'US', currency: 'USD', exchange: 'NAS',
    side, quantity: 1, orderPrice: 50, estimatedAmount: 50,
    idempotencyKey: key, decisionReason: 'test', liveOrderEnabled: false, status
  });
}

// ── 하루 1회 매수: hasBuyOrderToday ──────────────────────────────────────

test('주문이 없으면 hasBuyOrderToday는 false', () => {
  const strategy = makeStrategy();
  const tradeDate = new Date().toISOString().slice(0, 10);
  assert.equal(repo.hasBuyOrderToday(user.id, strategy.id, tradeDate), false);
});

test('오늘 매수(BUY) 주문이 있으면 hasBuyOrderToday는 true', () => {
  const strategy = makeStrategy();
  const tradeDate = new Date().toISOString().slice(0, 10);
  makeOrder(strategy.id, { side: 'BUY', status: 'ACCEPTED', key: `k-buy-${strategy.id}` });
  assert.equal(repo.hasBuyOrderToday(user.id, strategy.id, tradeDate), true);
});

test('매도(SELL) 주문만 있으면 hasBuyOrderToday는 false (매도는 하루 1회 매수 제한과 무관)', () => {
  const strategy = makeStrategy();
  const tradeDate = new Date().toISOString().slice(0, 10);
  makeOrder(strategy.id, { side: 'SELL', status: 'ACCEPTED', key: `k-sell-${strategy.id}` });
  assert.equal(repo.hasBuyOrderToday(user.id, strategy.id, tradeDate), false);
});

test('실패(FAILED)한 매수 주문도 오늘의 매수 시도로 계산된다 (재시도 안 함)', () => {
  const strategy = makeStrategy();
  const tradeDate = new Date().toISOString().slice(0, 10);
  makeOrder(strategy.id, { side: 'BUY', status: 'FAILED', key: `k-fail-${strategy.id}` });
  assert.equal(repo.hasBuyOrderToday(user.id, strategy.id, tradeDate), true);
});

test('hasBuyOrderToday는 전략별로 분리된다', () => {
  const a = makeStrategy();
  const b = makeStrategy();
  const tradeDate = new Date().toISOString().slice(0, 10);
  makeOrder(a.id, { side: 'BUY', status: 'ACCEPTED', key: `k-iso-${a.id}` });
  assert.equal(repo.hasBuyOrderToday(user.id, a.id, tradeDate), true);
  assert.equal(repo.hasBuyOrderToday(user.id, b.id, tradeDate), false);
});

// ── 해외 주문 단가 정규화: roundOverseasOrderPrice ───────────────────────

test('큰수 매수 지정가의 긴 소수를 호가 단위로 반올림한다', () => {
  // 평단가 55 × 1.1 = 60.50000000000001 같은 값 → 2자리로 정규화
  assert.equal(roundOverseasOrderPrice(60.50000000000001), 60.5);
  assert.equal(roundOverseasOrderPrice(56.1 * 1.1), 61.71);
  assert.equal(roundOverseasOrderPrice(123.456789), 123.46);
});

test('1달러 미만은 소수 4자리, 잘못된 값은 0', () => {
  assert.equal(roundOverseasOrderPrice(0.123456), 0.1235);
  assert.equal(roundOverseasOrderPrice(0), 0);
  assert.equal(roundOverseasOrderPrice(-1), 0);
  assert.equal(roundOverseasOrderPrice(undefined), 0);
});
