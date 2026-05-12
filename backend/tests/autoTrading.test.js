import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const autoTradingService = await import('../src/services/autoTradingService.js');
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
