import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const autoTradingService = await import('../src/services/autoTradingService.js');
const { evaluateAutoTrading } = await import('../src/services/autoTradingStrategyEngine.js');
const repo = await import('../src/repositories/autoTradingRepository.js');

const alice = createUser(db, 'alice-auto@example.com');
const bob = createUser(db, 'bob-auto@example.com');
credentialService.saveSettings(alice.id, {
  appKey: 'app-auto',
  appSecret: 'sec-auto',
  accountNumber: '12345678',
  accountProductCode: '01'
});

test.after(() => tmp.cleanup());

test('auto trading holds when current price is above big-number buy ceiling', () => {
  // 큰수 매수 상한 = 평단가 55 × 1.02 = 56.1. previousClose(500)는 무관해야 한다.
  const result = evaluateAutoTrading({
    symbol: 'TQQQ',
    market: 'US',
    currency: 'USD',
    currentPrice: 57,
    holdingQuantity: 1,
    averagePrice: 55,
    previousClose: 500,
    cashAvailable: 1000,
    currentRound: 1,
    totalBudget: 4000,
    splitCount: 40,
    targetProfitRate: 0.1,
    bigBuyPremiumRate: 0.02
  });
  assert.equal(result.decision, 'HOLD');
  assert.match(result.reason, /큰수 지정가/);
});

test('auto trading buys when current price is within big-number buy ceiling', () => {
  // totalBudget 8000 / 40분할 → 회차 예산 200, 절반 100.
  // 큰수 지정가 = 평단가 55 × 1.02 = 56.1 → 1주 매수 가능. previousClose(20)는 무관.
  const result = evaluateAutoTrading({
    symbol: 'TQQQ',
    market: 'US',
    currency: 'USD',
    currentPrice: 56,
    holdingQuantity: 1,
    averagePrice: 55,
    previousClose: 20,
    cashAvailable: 1000,
    currentRound: 1,
    totalBudget: 8000,
    splitCount: 40,
    targetProfitRate: 0.1,
    bigBuyPremiumRate: 0.02
  });
  assert.equal(result.decision, 'BUY');
  assert.equal(result.intents.length, 1);
  assert.equal(result.intents[0].half, 'BIG');
  assert.equal(result.expectedQuantity, 1);
  assert.equal(result.intents[0].orderPrice, 55 * 1.02);
});

test('회차 예산으로 1주도 못 사면 HOLD (이월 없이 관망)', () => {
  // 회차 예산 4000/40=100, 절반 50. 평단가 80 → floor(50/80)=0 → 두 슬롯 모두 1주 못 삼.
  const result = evaluateAutoTrading({
    symbol: 'AAPL', market: 'US', currency: 'USD',
    currentPrice: 70, holdingQuantity: 1, averagePrice: 80,
    cashAvailable: 1000, currentRound: 1,
    totalBudget: 4000, splitCount: 40, targetProfitRate: 0.1, bigBuyPremiumRate: 0.1
  });
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.intents.length, 0);
});

test('2회차 매수: 평단가 매수·큰수 매수가 같은 평가에서 함께 나온다', () => {
  // 회차 예산 8000/40=200, 절반 100. 평단가 80 → AVG 1주, 큰수가 88 → BIG 1주.
  const result = evaluateAutoTrading({
    symbol: 'AAPL', market: 'US', currency: 'USD',
    currentPrice: 70, holdingQuantity: 1, averagePrice: 80,
    cashAvailable: 10000, currentRound: 4,
    totalBudget: 8000, splitCount: 40, targetProfitRate: 0.1, bigBuyPremiumRate: 0.1
  });
  assert.equal(result.decision, 'BUY');
  assert.equal(result.intents.length, 2);
  assert.deepEqual(result.intents.map((i) => i.half), ['AVG', 'BIG']);
});

test('이미 산 슬롯(executedHalves)은 같은 날 다시 매수하지 않는다', () => {
  // 오늘 큰수 매수는 이미 했고 평단가 매수만 남음 → AVG 슬롯만 나온다.
  const result = evaluateAutoTrading({
    symbol: 'AAPL', market: 'US', currency: 'USD',
    currentPrice: 70, holdingQuantity: 1, averagePrice: 80,
    cashAvailable: 10000, currentRound: 4,
    totalBudget: 8000, splitCount: 40, targetProfitRate: 0.1, bigBuyPremiumRate: 0.1,
    executedHalves: ['BIG']
  });
  assert.equal(result.decision, 'BUY');
  assert.equal(result.intents.length, 1);
  assert.equal(result.intents[0].half, 'AVG');
});

test('1회차 첫 매수를 마친 날은 추가 매수하지 않는다', () => {
  const result = evaluateAutoTrading({
    symbol: 'AAPL', market: 'US', currency: 'USD',
    currentPrice: 70, holdingQuantity: 5, averagePrice: 70,
    cashAvailable: 10000, currentRound: 1,
    totalBudget: 8000, splitCount: 40, targetProfitRate: 0.1, bigBuyPremiumRate: 0.1,
    executedHalves: ['FIRST']
  });
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.intents.length, 0);
});

test('익절 매도 → 사이클 재시작 신호와 다음 사이클 예산(총자산)', () => {
  const result = evaluateAutoTrading({
    symbol: 'AAPL', market: 'US', currency: 'USD',
    currentPrice: 111, // 평단가 100 × 1.1 = 110 초과 → 익절
    holdingQuantity: 10, averagePrice: 100,
    cashAvailable: 500, currentRound: 5,
    totalBudget: 4000, splitCount: 40, targetProfitRate: 0.1, bigBuyPremiumRate: 0.1
  });
  assert.equal(result.decision, 'SELL');
  assert.equal(result.restartCycle, true);
  assert.equal(result.expectedQuantity, 10);
  // 다음 사이클 예산 = 총자산 = 현금 500 + 보유 10주 × 111 = 1610
  assert.equal(result.nextCycleBudget, 1610);
});

test('회차 소진 + 현금 부족 → 보유 1/4 매도 후 사이클 재시작', () => {
  const result = evaluateAutoTrading({
    symbol: 'AAPL',
    market: 'US',
    currency: 'USD',
    currentPrice: 90,
    holdingQuantity: 8,
    averagePrice: 100,
    previousClose: 95,
    cashAvailable: 10, // 회차 예산 100보다 적음
    currentRound: 40,
    totalBudget: 4000,
    splitCount: 40,
    targetProfitRate: 0.1,
    bigBuyPremiumRate: 0.1
  });
  assert.equal(result.decision, 'SELL');
  assert.equal(result.restartCycle, true);
  // 보유 8주의 1/4 = 2주 매도
  assert.equal(result.expectedQuantity, 2);
  // 다음 사이클 예산 = 현금 10 + 보유 8주 × 90 = 730
  assert.equal(result.nextCycleBudget, 730);
});

test('cycleBudget 입력이 회차 예산 기준이 된다 (복리 재시작 반영)', () => {
  // cycleBudget 8000 / 40 = 회차 200, 절반 100. 평단가 80 → 1주, 큰수 88 → 1주.
  const result = evaluateAutoTrading({
    symbol: 'AAPL',
    market: 'US',
    currency: 'USD',
    currentPrice: 70,
    holdingQuantity: 1,
    averagePrice: 80,
    previousClose: 80,
    cashAvailable: 5000,
    currentRound: 2,
    totalBudget: 4000,
    splitCount: 40,
    targetProfitRate: 0.1,
    bigBuyPremiumRate: 0.1,
    cycleBudget: 8000
  });
  assert.equal(result.decision, 'BUY');
  assert.equal(result.expectedQuantity, 2);
});

function mockKis({ orderOk = true } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url);
    calls.push({ url: text, method: init.method || 'GET', body: init.body || '' });
    if (text.endsWith('/oauth2/tokenP')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'auto-token', expires_in: 3600 }) };
    }
    if (text.includes('/uapi/overseas-price/v1/quotations/price')) {
      return { ok: true, status: 200, json: async () => ({ rt_cd: '0', output: { last: '50' } }) };
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-balance')) {
      return { ok: true, status: 200, json: async () => ({ rt_cd: '0', output1: [], output2: [{ frcr_buy_psbl_amt1: '10000' }] }) };
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-psamount')) {
      return { ok: true, status: 200, json: async () => ({ rt_cd: '0', output: { ovrs_ord_psbl_amt: '10000', max_ord_psbl_qty: '200' } }) };
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-nccs')) {
      return { ok: true, status: 200, json: async () => ({ rt_cd: '0', output: [] }) };
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/order')) {
      return {
        ok: orderOk,
        status: orderOk ? 200 : 400,
        json: async () => orderOk
          ? ({ rt_cd: '0', output: { ODNO: 'KIS-ORDER-1' } })
          : ({ rt_cd: '1', msg1: 'rejected' })
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

test('liveOrderEnabled=false evaluates and stores DRY_RUN without calling KIS order endpoint', async () => {
  const strategy = autoTradingService.createStrategy(alice.id, {
    symbol: 'TQQQ',
    market: 'US',
    currency: 'USD',
    totalBudget: 4000,
    splitCount: 40,
    targetProfitRate: 0.1
  });
  autoTradingService.startStrategy(alice.id, strategy.id);
  const mocked = mockKis();
  try {
    const result = await autoTradingService.evaluateStrategy(alice.id, strategy.id);
    assert.equal(result.decision.decision, 'BUY');
    assert.equal(result.order.status, 'DRY_RUN');
    assert.equal(result.order.liveOrderEnabled, false);
    assert.equal(mocked.calls.some((call) => call.url.includes('/trading/order')), false);
  } finally {
    mocked.restore();
  }
});

test('live order setting writes history', () => {
  const next = autoTradingService.updateLiveOrderSetting(alice.id, true);
  assert.equal(next.liveOrderEnabled, true);
  const histories = repo.listSettingHistories(alice.id);
  assert.equal(histories[0].previousLiveOrderEnabled, false);
  assert.equal(histories[0].newLiveOrderEnabled, true);
});

test('liveOrderEnabled=true sends KIS order only after safety checks pass', async () => {
  const strategy = autoTradingService.createStrategy(alice.id, {
    symbol: 'QQQ',
    market: 'US',
    currency: 'USD',
    totalBudget: 4000,
    splitCount: 40,
    targetProfitRate: 0.1
  });
  autoTradingService.startStrategy(alice.id, strategy.id);
  const mocked = mockKis();
  try {
    const result = await autoTradingService.evaluateStrategy(alice.id, strategy.id);
    assert.equal(result.decision.decision, 'BUY');
    assert.equal(result.order.status, 'ACCEPTED');
    assert.equal(result.order.kisOrderNo, 'KIS-ORDER-1');
    assert.equal(mocked.calls.some((call) => call.url.includes('/uapi/overseas-stock/v1/trading/order')), true);
    assert.doesNotMatch(result.order.requestPayloadMasked || '', /12345678|sec-auto|auto-token/);
  } finally {
    mocked.restore();
  }
});

test('userId scope blocks another user from reading auto trading strategy', () => {
  const strategy = autoTradingService.listStrategies(alice.id)[0];
  let thrown;
  try {
    autoTradingService.getStrategy(bob.id, strategy.id);
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.status, 404);
});
