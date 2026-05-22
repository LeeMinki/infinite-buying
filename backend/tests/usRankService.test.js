import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const service = await import('../src/services/usRankService.js');
const repo = await import('../src/repositories/usRankRepository.js');
const autoTradingRepo = await import('../src/repositories/autoTradingRepository.js');

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
      // 1위 종목은 state에서 동적으로 정해 익절 후 동일 종목 재매수 보류 케이스를 피한다.
      // 정렬은 등락률 내림차순이라 top 종목에 가장 큰 rate를 줘서 selectRankingCandidate가 top을 픽하게 한다.
      const top = state.rankingTopSymbol || 'HOT1';
      return json({
        rt_cd: '0',
        output2: [
          { symb: top, name: top, last: '50', rate: '50.0', rank: '1' },
          { symb: 'OTHER', name: 'Other', last: '70', rate: '10.0', rank: '2' }
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
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    await service.startStrategy(user.id, strategy.id);
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
      assert.ok(/매수 후보가 없어/.test(result.decision.reason));
    });
    assert.equal(repo.listDecisionLogs(user.id, strategy.id).length, startLogs + 1);
    assert.equal(repo.listTrades(user.id, { strategyId: strategy.id }).length, startTrades);
  } finally {
    globalThis.fetch = RealFetch;
  }
});

test('실주문 OFF에서 정규장 진입, 익절 후 재매수, 손절 잠금, 강제 청산을 기록한다', async () => {
  const state = { price: 50, cash: 1000, balanceQuantity: 20, averagePrice: 50, rankingTopSymbol: 'HOT1', symbol: 'HOT1' };
  await withMockedFetch(state, async () => {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: false,
      fixedBuyUsdAmount: 1000,
      targetProfitRate: 0.02,
      stopLossRate: 0.05,
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    await service.startStrategy(user.id, strategy.id);

    await withMockedDate('2026-05-18T14:00:00Z', async () => {
      const firstBuy = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(firstBuy.decision.decision, 'BUY');
      assert.equal(firstBuy.order.status, 'DRY_RUN');
      assert.equal(state.orderCalls || 0, 0);
    });

    state.price = 52;
    state.rankingTopSymbol = 'HOT3'; // 익절 시점에 1위가 바뀌어 보유 종목과 다른 종목 → 매도 진행
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
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    await service.startStrategy(user.id, stopStrategy.id);
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
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    await service.startStrategy(user.id, forceStrategy.id);
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

test('익절 도달이지만 보유 종목이 지금도 상승률 1위면 매도를 보류한다', async () => {
  const state = { price: 52, cash: 0, balanceQuantity: 20, averagePrice: 50, rankingTopSymbol: 'HOT1', symbol: 'HOT1' };
  await withMockedFetch(state, async () => {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: false,
      fixedBuyUsdAmount: 1000,
      targetProfitRate: 0.02,
      stopLossRate: 0.05,
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    await service.startStrategy(user.id, strategy.id);
    repo.setHolding(user.id, strategy.id, { symbol: 'HOT1', symbolName: 'Hot One', exchange: 'NAS', quantity: 20, averagePrice: 50 });

    await withMockedDate('2026-05-21T14:00:00Z', async () => {
      // 익절 +4% 도달 + 랭킹 1위 == 보유 종목 → 매도하지 않고 HOLD
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'HOLD');
      assert.ok(/지금도 상승률 1위/.test(result.decision.reason));
    });

    // 1위가 다른 종목으로 바뀌면 매도 진행
    state.rankingTopSymbol = 'NEW1';
    await withMockedDate('2026-05-21T14:01:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SELL');
      assert.equal(result.decision.sellReason, 'TARGET');
    });
  });
});

test('실주문 매수는 접수만으로 보유 전환하지 않고 KIS 체결 확인 후 전환한다', async () => {
  // 사고 재현 방지: 매수 접수(ACCEPTED) != 체결. 체결 전 보유로 전환하면 다음 tick에
  // 미체결 종목을 매도 평가해 잘못 청산한다. 체결이 확인돼야만 보유로 넘어가야 한다.
  const state = { price: 50, cash: 1000, balanceQuantity: 0, averagePrice: 50, rankingTopSymbol: 'FILLCHK', symbol: 'FILLCHK' };
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(user.id, {
        autoBudgetEnabled: false,
        fixedBuyUsdAmount: 1000,
        targetProfitRate: 0.02,
        stopLossRate: 0.05,
        forceCloseKst: '04:30',
        exchange: 'NAS'
      });
      await service.startStrategy(user.id, strategy.id);

      // tick1: 매수 주문 접수. 아직 체결 안 됨(balanceQuantity 0) → 보유로 전환하지 않는다.
      await withMockedDate('2026-05-18T14:00:00Z', async () => {
        const buy = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(buy.decision.decision, 'BUY');
        assert.equal(buy.order.status, 'ACCEPTED');
      });
      assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, null);

      // tick2: 접수됐으나 여전히 미체결 → 보유 전환 보류
      await withMockedDate('2026-05-18T14:01:00Z', async () => {
        const wait = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(wait.decision.decision, 'SKIP');
        assert.ok(/체결되지 않아 보유 전환을 보류/.test(wait.decision.reason));
      });
      assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, null);

      // tick3: KIS 잔고에 체결분이 잡힘 → 보유로 전환
      state.balanceQuantity = 20;
      state.averagePrice = 50;
      await withMockedDate('2026-05-18T14:02:00Z', async () => {
        const confirmed = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(confirmed.decision.decision, 'SKIP');
        assert.ok(/매수 체결 확인/.test(confirmed.decision.reason));
      });
      const held = repo.getStrategy(user.id, strategy.id);
      assert.equal(held.holdingSymbol, 'FILLCHK');
      assert.equal(held.holdingQuantity, 20);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('누적 목표 도달 시 강제 매도하고 전략을 영구 종료한다', async () => {
  // baseline 1000, 보유 20주 × 52 = 1040 (현금 0) → +4%. cycle target 0.03이면 도달.
  const state = { price: 52, cash: 0, balanceQuantity: 20, averagePrice: 50, rankingTopSymbol: 'OTHER', symbol: 'HOT1' };
  await withMockedFetch(state, async () => {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: false,
      fixedBuyUsdAmount: 1000,
      targetProfitRate: 0.10, // 익절 기준 안 닿게
      stopLossRate: 0.20,
      forceCloseKst: '04:30',
      exchange: 'NAS',
      cycleTargetProfitRate: 0.03
    });
    await service.startStrategy(user.id, strategy.id);
    repo.setCycleBaseline(user.id, strategy.id, 1000);
    repo.setHolding(user.id, strategy.id, { symbol: 'HOT1', symbolName: 'Hot One', exchange: 'NAS', quantity: 20, averagePrice: 50 });

    await withMockedDate('2026-05-22T14:00:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.sellReason, 'CYCLE_COMPLETE');
      const after = repo.getStrategy(user.id, strategy.id);
      assert.equal(after.cycleCompleted, true);
      assert.equal(after.status, 'STOPPED');
    });
  });
});
