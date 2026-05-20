import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const service = await import('../src/services/usRankService.js');
const repo = await import('../src/repositories/usRankRepository.js');

const user = createUser(db, 'us-rank-service@example.com');
credentialService.saveSettings(user.id, {
  appKey: 'app-us-rank',
  appSecret: 'secret-us-rank',
  accountNumber: '12345678',
  accountProductCode: '01'
});

test.after(() => tmp.cleanup());

function withMockedDate(iso, run) {
  const RealDate = globalThis.Date;
  const fixed = new RealDate(iso);
  class FakeDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed.getTime();
    }
    static parse(value) {
      return RealDate.parse(value);
    }
    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  }
  globalThis.Date = FakeDate;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.Date = RealDate;
    });
}

function withMockedFetch(state, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) {
      return json({ rt_cd: '0', access_token: 'tok-us-rank', expires_in: 3600 });
    }
    if (text.includes('/uapi/overseas-stock/v1/ranking/updown-rate')) {
      return json({
        rt_cd: '0',
        output2: [
          { symb: 'HOT1', name: 'Hot One', last: '50', rate: '18.5', rank: '1' },
          { symb: 'HOT2', name: 'Too Hot', last: '70', rate: '28.1', rank: '2' }
        ]
      });
    }
    if (text.includes('/uapi/overseas-price/v1/quotations/price')) {
      return json({ rt_cd: '0', output: { last: String(state.price ?? 50) } });
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-psamount')) {
      return json({ rt_cd: '0', output: { frcr_ord_psbl_amt1: String(state.cash ?? 1000), max_ord_psbl_qty: '999' } });
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-nccs')) {
      return json({ rt_cd: '0', output: [] });
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-balance')) {
      return json({
        rt_cd: '0',
        output1: state.balanceQuantity > 0
          ? [{ ovrs_pdno: state.symbol || 'HOT1', ovrs_cblc_qty: String(state.balanceQuantity), pchs_avg_pric: String(state.averagePrice || 50), now_pric2: String(state.price ?? 50) }]
          : [],
        output2: { frcr_buy_psbl_amt1: String(state.cash ?? 1000) }
      });
    }
    if (options.method === 'POST' && text.includes('/uapi/overseas-stock/v1/trading/order')) {
      state.orderCalls = (state.orderCalls || 0) + 1;
      return json({ rt_cd: '0', output: { ODNO: `ORD${state.orderCalls}` } });
    }
    return json({ rt_cd: '0', output: {} });
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('매수 후보 없음(SCHEDULED)은 trade 행을 만들지 않고 로그도 남기지 않는다', async () => {
  const state = { price: 0, cash: 1000, balanceQuantity: 0 };
  const RealFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) return json({ rt_cd: '0', access_token: 'tok', expires_in: 3600 });
    if (text.includes('/uapi/overseas-stock/v1/ranking/updown-rate')) {
      // 후보 없음(빈 응답)
      return json({ rt_cd: '0', output2: [] });
    }
    return json({ rt_cd: '0', output: {} });
  };
  try {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: false,
      fixedBuyUsdAmount: 1000,
      targetProfitRate: 0.02,
      stopLossRate: 0.05,
      maxFluctuationRate: 0.2,
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    service.startStrategy(user.id, strategy.id);
    const startLogs = repo.listDecisionLogs(user.id, strategy.id).length;
    const startTrades = repo.listTrades(user.id, { strategyId: strategy.id }).length;
    await withMockedDate('2026-05-20T14:00:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      // SCHEDULED + 후보 없음은 trade 안 만들고 noLog 처리
      assert.equal(result.decision, null);
    });
    assert.equal(repo.listTrades(user.id, { strategyId: strategy.id }).length, startTrades);
    assert.equal(repo.listDecisionLogs(user.id, strategy.id).length, startLogs);
    // MANUAL은 사유를 응답에 보여주기 위해 로그를 남긴다
    await withMockedDate('2026-05-20T14:01:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.ok(/매수 대상이 없어/.test(result.decision.reason));
    });
    assert.equal(repo.listDecisionLogs(user.id, strategy.id).length, startLogs + 1);
    assert.equal(repo.listTrades(user.id, { strategyId: strategy.id }).length, startTrades);
  } finally {
    globalThis.fetch = RealFetch;
  }
});

test('실주문 OFF에서 정규장 진입, 익절 후 재매수, 손절 잠금, 강제 청산을 기록한다', async () => {
  const state = { price: 50, cash: 1000, balanceQuantity: 20, averagePrice: 50 };
  await withMockedFetch(state, async () => {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: false,
      fixedBuyUsdAmount: 1000,
      targetProfitRate: 0.02,
      stopLossRate: 0.05,
      maxFluctuationRate: 0.2,
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    service.startStrategy(user.id, strategy.id);

    await withMockedDate('2026-05-18T14:00:00Z', async () => {
      const firstBuy = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(firstBuy.decision.decision, 'BUY');
      assert.equal(firstBuy.order.status, 'DRY_RUN');
      assert.equal(state.orderCalls || 0, 0);
    });

    state.price = 52;
    await withMockedDate('2026-05-18T14:01:00Z', async () => {
      const targetSell = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(targetSell.decision.decision, 'SELL');
      assert.equal(targetSell.decision.sellReason, 'TARGET');
    });

    state.price = 50;
    await withMockedDate('2026-05-18T14:02:00Z', async () => {
      const secondBuy = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(secondBuy.decision.decision, 'BUY');
      assert.equal(secondBuy.decision.tradeSeq, 2);
    });

    const stopStrategy = service.createStrategy(user.id, {
      autoBudgetEnabled: false,
      fixedBuyUsdAmount: 1000,
      targetProfitRate: 0.02,
      stopLossRate: 0.05,
      maxFluctuationRate: 0.2,
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    service.startStrategy(user.id, stopStrategy.id);
    repo.setHolding(user.id, stopStrategy.id, { symbol: 'HOT1', symbolName: 'Hot One', exchange: 'NAS', quantity: 10, averagePrice: 50 });
    state.price = 47;
    await withMockedDate('2026-05-18T14:03:00Z', async () => {
      const stop = await service.evaluateStrategy(user.id, stopStrategy.id);
      assert.equal(stop.decision.sellReason, 'STOP_LOSS');
      assert.equal(repo.getStrategy(user.id, stopStrategy.id).dayLockedOut, true);
    });

    const forceStrategy = service.createStrategy(user.id, {
      autoBudgetEnabled: false,
      fixedBuyUsdAmount: 1000,
      targetProfitRate: 0.02,
      stopLossRate: 0.05,
      maxFluctuationRate: 0.2,
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    service.startStrategy(user.id, forceStrategy.id);
    repo.setHolding(user.id, forceStrategy.id, { symbol: 'HOT1', symbolName: 'Hot One', exchange: 'NAS', quantity: 10, averagePrice: 50 });
    state.price = 50;
    state.averagePrice = 50;
    await withMockedDate('2026-05-19T19:30:00Z', async () => {
      const force = await service.evaluateStrategy(user.id, forceStrategy.id);
      assert.equal(force.decision.sellReason, 'FORCE_CLOSE');
      assert.equal(repo.getStrategy(user.id, forceStrategy.id).dayLockedOut, true);
    });
  });
});
