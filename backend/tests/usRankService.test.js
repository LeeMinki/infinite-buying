import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const { env } = await import('../src/config/env.js');
const credentialService = await import('../src/services/kisCredentialService.js');
const service = await import('../src/services/usRankService.js');
const repo = await import('../src/repositories/usRankRepository.js');
const autoTradingRepo = await import('../src/repositories/autoTradingRepository.js');
const originalEnableLiveOrder = env.enableLiveOrder;
env.enableLiveOrder = 'true';

const user = createUser(db, 'us-rank-service@example.com');
credentialService.saveSettings(user.id, {
  appKey: 'app-us-rank',
  appSecret: 'secret-us-rank',
  accountNumber: '12345678',
  accountProductCode: '01'
});

test.after(() => {
  env.enableLiveOrder = originalEnableLiveOrder;
  tmp.cleanup();
});

async function withEnvOverride(overrides, run) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = env[key];
    env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) env[key] = value;
  }
}

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
      if (state.rankingRows) {
        return json({ rt_cd: '0', output2: state.rankingRows });
      }
      // 정렬은 등락률 내림차순이라 top 종목에 가장 큰 rate를 줘서 selectRankingCandidate가 top을 픽하게 한다.
      const top = state.rankingTopSymbol || 'HOT1';
      // rate는 %값 — 30.0 → 등락률 0.30. 진입 유니버스 등락률 상한(+50%) 아래라 후보로 통과한다.
      return json({
        rt_cd: '0',
        output2: [
          { symb: top, name: top, last: '50', rate: '30.0', rank: '1', tvol: '20000000' },
          { symb: 'OTHER', name: 'Other', last: '70', rate: '10.0', rank: '2', tvol: '15000000' }
        ]
      });
    }
    if (text.includes('/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice')) {
      // 매수 후보 단기 흐름 필터용 분봉. 기본은 필터를 통과하는 상승 추세, state.minuteCandles로 재정의 가능.
      return json({ rt_cd: '0', output2: state.minuteCandles || passingMinuteCandles() });
    }
    if (text.includes('/uapi/overseas-price/v1/quotations/price')) {
      const symbol = new URL(text).searchParams.get('SYMB') || new URL(text).searchParams.get('PDNO') || state.symbol || state.rankingTopSymbol;
      const price = state.prices?.[symbol] ?? state.price ?? 50;
      return json({ rt_cd: '0', output: { last: String(price) } });
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-psamount')) {
      const symbol = new URL(text).searchParams.get('ITEM_CD') || state.symbol || state.rankingTopSymbol;
      const cash = state.cashBySymbol?.[symbol] ?? state.cash ?? 1000;
      return json({ rt_cd: '0', output: { frcr_ord_psbl_amt1: String(cash), max_ord_psbl_qty: '999' } });
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-nccs')) {
      if (state.openOrdersError) {
        return json({ rt_cd: '1', msg_cd: 'TEST_OPEN_ORDERS', msg1: '미체결 조회 실패' });
      }
      return json({ rt_cd: '0', output: state.openOrders || [] });
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-ccnl')) {
      // 체결조회(TTTS3035R) — 매도 체결 확인용. state.orderHistory로 체결 내역을 재정의한다.
      return json({ rt_cd: '0', output: [
        ...(state.orderHistory || []),
        ...(state.cancelHistoryRows || [])
      ] });
    }
    if (options.method === 'POST' && text.includes('/uapi/overseas-stock/v1/trading/order-rvsecncl')) {
      state.cancelCalls = (state.cancelCalls || 0) + 1;
      if (state.confirmCancellation !== false) {
        const body = JSON.parse(options.body || '{}');
        state.openOrders = (state.openOrders || []).filter((row) => (
          String(row.odno || row.ODNO || '') !== String(body.ORGN_ODNO || '')
        ));
        if (state.balanceAfterCancel != null) state.balanceQuantity = state.balanceAfterCancel;
        state.cancelHistoryRows = state.cancelHistoryRows || [];
        state.cancelHistoryRows.push({
          odno: `CANCEL${state.cancelCalls}`,
          orgn_odno: String(body.ORGN_ODNO || ''),
          ovrs_pdno: String(body.PDNO || state.symbol || ''),
          rvse_cncl_dvsn: '02',
          prcs_stat_name: '완료',
          ft_ord_qty: String(body.ORD_QTY || '0'),
          ft_ccld_qty: '0',
          nccs_qty: '0',
          ft_ccld_unpr3: '0'
        });
      }
      return json({ rt_cd: '0', output: { ODNO: `CANCEL${state.cancelCalls}` } });
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
      if (state.orderNetworkError) throw new Error('simulated order response timeout');
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

// 단기 흐름 필터(checkUsBuyCandidate)를 통과하는 상승 추세 분봉(시가<종가, 종가 상승, 거래량 일정).
// KIS 해외 분봉은 최신 봉이 앞에 오므로 reverse 해 그 정렬도 함께 검증한다.
function passingMinuteCandles() {
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    const close = 40 + i;
    out.push({
      xhms: String(100000 + i * 100),
      open: (close - 0.5).toFixed(2),
      high: (close + 0.2).toFixed(2),
      low: (close - 0.7).toFixed(2),
      last: close.toFixed(2),
      evol: '100000'
    });
  }
  return out.reverse();
}

function createHeldTradeWithBuy(userId, strategy, {
  symbol,
  symbolName,
  liveOrderEnabled = true,
  tradeDate = '2026-05-21'
}) {
  repo.setHolding(userId, strategy.id, {
    symbol, symbolName, exchange: 'NAS', quantity: 10, averagePrice: 50
  });
  let trade = repo.createTrade(userId, {
    strategyId: strategy.id,
    tradeDate,
    tradeSeq: 1,
    symbol,
    symbolName,
    exchange: 'NAS',
    selectedPrice: 50,
    selectedFluctuationRate: 0.2,
    status: 'BOUGHT'
  });
  trade = repo.updateTradeOutcome(trade.id, {
    status: 'BOUGHT', entryPrice: 50, entryQuantity: 10
  });
  const buy = repo.createOrder(userId, {
    strategyId: strategy.id,
    tradeId: trade.id,
    symbol,
    symbolName,
    exchange: 'NAS',
    side: 'BUY',
    quantity: 10,
    orderPrice: 50,
    estimatedAmount: 500,
    kisOrderNo: liveOrderEnabled ? `BUY-${strategy.id}-${trade.id}` : null,
    status: liveOrderEnabled ? 'FILLED' : 'DRY_RUN',
    filledQuantity: 10,
    remainingQuantity: 0,
    averageFilledPrice: 50,
    idempotencyKey: `US-${strategy.id}-${trade.id}-BUY`,
    decisionReason: '포지션 provenance 테스트 매수',
    liveOrderEnabled
  });
  return { trade, buy };
}

function createHeldTradeWithTarget(userId, strategy, {
  symbol, symbolName, orderNo, originalOrderNo
}) {
  const { trade, buy } = createHeldTradeWithBuy(userId, strategy, { symbol, symbolName });
  const target = repo.createOrder(userId, {
    strategyId: strategy.id,
    tradeId: trade.id,
    symbol,
    symbolName,
    exchange: 'NAS',
    side: 'SELL',
    sellReason: 'TARGET',
    quantity: 10,
    orderPrice: 51,
    estimatedAmount: 510,
    kisOrderNo: orderNo,
    kisOriginalOrderNo: originalOrderNo,
    status: 'ACCEPTED',
    idempotencyKey: `US-${strategy.id}-${symbol}-TARGET`,
    decisionReason: '목표가 주문',
    liveOrderEnabled: true
  });
  return { trade, buy, target };
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
      const target = repo.listOrders(user.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
      assert.equal(target.status, 'DECIDED');
      assert.equal(target.liveOrderEnabled, false);
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

test('익절 도달 시 보유 종목이 지금도 상승률 1위여도 전량 매도한다', async () => {
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
      // 익절 +4% 도달이면 랭킹 1위 여부와 관계없이 매도한다.
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SELL');
      assert.equal(result.decision.sellReason, 'TARGET');
    });
  });
});

test('미국장 랭킹 매수는 고정 금액 설정이 있어도 매수가능금액 전액을 기준으로 계산한다', async () => {
  const state = { price: 50, cash: 1000, balanceQuantity: 0, averagePrice: 50, rankingTopSymbol: 'FULLCASH', symbol: 'FULLCASH' };
  await withMockedFetch(state, async () => {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: false,
      fixedBuyUsdAmount: 50,
      targetProfitRate: 0.02,
      stopLossRate: 0.05,
      forceCloseKst: '04:30',
      exchange: 'NAS'
    });
    await service.startStrategy(user.id, strategy.id);

    await withMockedDate('2026-05-21T14:00:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'BUY');
      assert.equal(result.decision.expectedQuantity, 20);
      assert.equal(result.decision.expectedAmount, 1000);
    });
  });
});

test('미국장 랭킹: 미체결 조회에 실패하면 실주문을 보내지 않고 다음 평가를 기다린다', async () => {
  const state = {
    price: 50,
    cash: 1000,
    balanceQuantity: 0,
    rankingTopSymbol: 'SAFECHK',
    symbol: 'SAFECHK',
    openOrdersError: true
  };
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(user.id, {
        autoBudgetEnabled: true,
        fixedBuyUsdAmount: 0,
        targetProfitRate: 0.02,
        stopLossRate: 0.05,
        forceCloseKst: '04:30',
        exchange: 'NAS'
      });
      await service.startStrategy(user.id, strategy.id);

      await withMockedDate('2026-05-21T14:00:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /미체결 주문을 확인하지 못해 안전상 주문하지 않습니다/);
        assert.equal(result.order, null);
        assert.equal(state.orderCalls || 0, 0);
        assert.equal(repo.getStrategy(user.id, strategy.id).status, 'RUNNING');
      });
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('미국장 랭킹: 매도 조건에서도 미체결 조회에 실패하면 매도 주문을 전송하지 않는다', async () => {
  const sellUser = createUser(db, 'us-rank-open-orders-sell@example.com');
  credentialService.saveSettings(sellUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(sellUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 10,
    averagePrice: 50,
    symbol: 'SAFESELL',
    rankingTopSymbol: 'SAFESELL',
    openOrdersError: true
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(sellUser.id, {
        targetProfitRate: 0.02,
        stopLossRate: 0.05,
        forceCloseKst: '04:30',
        exchange: 'NAS'
      });
      await service.startStrategy(sellUser.id, strategy.id);
      const { trade, target } = createHeldTradeWithTarget(sellUser.id, strategy, {
        symbol: 'SAFESELL',
        symbolName: 'Safe Sell',
        orderNo: 'SAFE-TARGET-1',
        originalOrderNo: 'SAFE-TARGET-ORIG-1'
      });

      await withMockedDate('2026-05-21T14:00:00Z', async () => {
        const result = await service.evaluateStrategy(sellUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /미체결 주문을 확인하지 못해 안전상 주문하지 않습니다/);
        assert.equal(result.order, null);
        assert.equal(state.orderCalls || 0, 0);
        assert.equal(state.cancelCalls || 0, 0);
      });

      const sellOrders = repo.listOrders(sellUser.id, { strategyId: strategy.id })
        .filter((order) => order.side === 'SELL');
      assert.equal(sellOrders.length, 1);
      assert.equal(repo.getOrder(sellUser.id, target.id).status, 'ACCEPTED');
      assert.equal(repo.getTradeById(trade.id).exitReason, null);
      assert.equal(repo.getStrategy(sellUser.id, strategy.id).holdingSymbol, 'SAFESELL');
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(sellUser.id, false);
  }
});

test('미국장 랭킹: 방어 매도 전 미체결 목록에서 자신의 목표가 주문만 제외한다', async () => {
  const sellUser = createUser(db, 'us-rank-target-exclusion@example.com');
  credentialService.saveSettings(sellUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(sellUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 10,
    averagePrice: 50,
    symbol: 'TARGETSAFE',
    rankingTopSymbol: 'TARGETSAFE',
    openOrders: [{
      odno: 'TARGET-SAFE-1',
      orgn_odno: 'TARGET-SAFE-ORIG-1',
      ovrs_pdno: 'TARGETSAFE',
      ft_ord_qty: '10',
      ft_ccld_qty: '0',
      ft_nccs_qty: '10',
      sll_buy_dvsn_cd: '01'
    }]
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(sellUser.id, {
        targetProfitRate: 0.02,
        stopLossRate: 0.05,
        forceCloseKst: '04:30',
        exchange: 'NAS'
      });
      await service.startStrategy(sellUser.id, strategy.id);
      const { target } = createHeldTradeWithTarget(sellUser.id, strategy, {
        symbol: 'TARGETSAFE',
        symbolName: 'Target Safe',
        orderNo: 'TARGET-SAFE-1',
        originalOrderNo: 'TARGET-SAFE-ORIG-1'
      });

      await withMockedDate('2026-05-21T14:00:00Z', async () => {
        const result = await service.evaluateStrategy(sellUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.decision.sellReason, 'STOP_LOSS');
        assert.equal(state.cancelCalls, 1);
        assert.equal(state.orderCalls, 1);
      });

      assert.equal(repo.getOrder(sellUser.id, target.id).status, 'CANCELED');
      const defensive = repo.listOrders(sellUser.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'STOP_LOSS');
      assert.ok(defensive);
      assert.equal(defensive.status, 'ACCEPTED');
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(sellUser.id, false);
  }
});

test('미국장 랭킹: 목표가 외 다른 미체결이 있으면 목표가를 유지하고 방어 매도를 보류한다', async () => {
  const sellUser = createUser(db, 'us-rank-other-open-order@example.com');
  credentialService.saveSettings(sellUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(sellUser.id, true);
  const openOrder = (orderNo, originalOrderNo) => ({
    odno: orderNo,
    orgn_odno: originalOrderNo,
    ovrs_pdno: 'TARGETBLOCK',
    ft_ord_qty: '10',
    ft_ccld_qty: '0',
    ft_nccs_qty: '10',
    sll_buy_dvsn_cd: '01'
  });
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 10,
    averagePrice: 50,
    symbol: 'TARGETBLOCK',
    rankingTopSymbol: 'TARGETBLOCK',
    openOrders: [
      openOrder('TARGET-BLOCK-1', 'TARGET-BLOCK-ORIG-1'),
      // 동일 조직번호를 TARGET identity로 오인해 제외하면 안 된다.
      openOrder('OTHER-OPEN-1', 'TARGET-BLOCK-ORIG-1')
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(sellUser.id, {
        targetProfitRate: 0.02,
        stopLossRate: 0.05,
        forceCloseKst: '04:30',
        exchange: 'NAS'
      });
      await service.startStrategy(sellUser.id, strategy.id);
      const { trade, target } = createHeldTradeWithTarget(sellUser.id, strategy, {
        symbol: 'TARGETBLOCK',
        symbolName: 'Target Block',
        orderNo: 'TARGET-BLOCK-1',
        originalOrderNo: 'TARGET-BLOCK-ORIG-1'
      });

      await withMockedDate('2026-05-21T14:00:00Z', async () => {
        const result = await service.evaluateStrategy(sellUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /미체결 주문이 있어 신규 주문을 만들지 않습니다/);
        assert.equal(state.cancelCalls || 0, 0);
        assert.equal(state.orderCalls || 0, 0);
      });

      assert.equal(repo.getOrder(sellUser.id, target.id).status, 'ACCEPTED');
      assert.equal(repo.getTradeById(trade.id).exitReason, null);
      assert.equal(repo.getStrategy(sellUser.id, strategy.id).holdingSymbol, 'TARGETBLOCK');
      const sellOrders = repo.listOrders(sellUser.id, { strategyId: strategy.id })
        .filter((order) => order.side === 'SELL');
      assert.equal(sellOrders.length, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(sellUser.id, false);
  }
});

test('단기 흐름 필터를 통과하지 못하면 매수하지 않고 SKIP 한다', async () => {
  // 하락 추세 분봉(현재가가 VWAP/시작가 아래) → 필터 탈락 → 후보 없음 SKIP, 주문 없음.
  const falling = [];
  for (let i = 0; i < 10; i += 1) {
    const close = 49 - i;
    falling.push({ xhms: String(100000 + i * 100), open: (close + 0.5).toFixed(2), high: (close + 0.7).toFixed(2), low: (close - 0.2).toFixed(2), last: close.toFixed(2), evol: '100000' });
  }
  const state = { price: 50, cash: 1000, balanceQuantity: 0, rankingTopSymbol: 'WEAK', symbol: 'WEAK', minuteCandles: falling.reverse() };
  await withMockedFetch(state, async () => {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: true, fixedBuyUsdAmount: 0, targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
    });
    await service.startStrategy(user.id, strategy.id);
    await withMockedDate('2026-05-21T14:00:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.equal(result.order, null);
      assert.equal(repo.listTrades(user.id, { strategyId: strategy.id }).length, 0);
    });
  });
});

test('미국장 랭킹은 매수가능금액으로 1주도 못 사는 후보를 건너뛰고 다음 후보를 산다', async () => {
  const state = {
    cash: 100,
    prices: { EXPENSIVE: 300, BUYABLE: 50 },
    symbol: 'BUYABLE',
    rankingRows: [
      { symb: 'EXPENSIVE', name: 'Expensive', last: '300', rate: '30.0', rank: '1', tvol: '20000000' },
      { symb: 'BUYABLE', name: 'Buyable', last: '50', rate: '20.0', rank: '2', tvol: '20000000' }
    ]
  };
  await withMockedFetch(state, async () => {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: true, fixedBuyUsdAmount: 0, targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
    });
    await service.startStrategy(user.id, strategy.id);
    await withMockedDate('2026-05-21T14:00:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'BUY');
      assert.equal(result.decision.selectedSymbol, 'BUYABLE');
      assert.equal(result.decision.expectedQuantity, 2);
      assert.equal(result.order.symbol, 'BUYABLE');
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

test('이전 거래일에 남은 SELECTED 매매는 오늘 이어받지 않고 폐기 후 새로 시작한다', async () => {
  const state = { price: 50, cash: 1000, balanceQuantity: 0, rankingTopSymbol: 'FRESH', symbol: 'FRESH' };
  await withMockedFetch(state, async () => {
    const strategy = service.createStrategy(user.id, {
      targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
    });
    await service.startStrategy(user.id, strategy.id);
    // 어제(전 거래일) SELECTED 상태로 남은 매매 행을 직접 만든다 (미체결로 장 마감된 상황).
    repo.createTrade(user.id, {
      strategyId: strategy.id, tradeDate: '2026-05-20', tradeSeq: 7,
      status: 'SELECTED', symbol: 'STALE', symbolName: 'Stale', exchange: 'NAS', selectedPrice: 99
    });
    await withMockedDate('2026-05-21T15:00:00Z', async () => { // 오늘 ET 11:00
      const result = await service.evaluateStrategy(user.id, strategy.id);
      // 어제 STALE이 아니라 오늘 랭킹의 FRESH로 새 매매가 시작돼야 한다.
      assert.equal(result.decision.decision, 'BUY');
      assert.equal(result.decision.selectedSymbol, 'FRESH');
    });
    const trades = repo.listTrades(user.id, { strategyId: strategy.id });
    const stale = trades.find((t) => t.symbol === 'STALE');
    assert.equal(stale.status, 'FAILED'); // 전날 매매는 폐기됨
  });
});

test('실주문 손절 매도는 접수만으로 청산하지 않고 KIS 체결 확인 후 실제 체결가로 확정한다', async () => {
  // 핵심 사고 방지: 매도 접수(ACCEPTED) != 체결. 접수를 청산으로 간주해 보유를 지우면 실제로는
  // 안 팔린 포지션이 앱에서 사라진다(고아 포지션·허구 손익). 체결조회로 확인된 뒤에만 청산을 확정한다.
  const sellUser = createUser(db, 'us-rank-sell@example.com');
  credentialService.saveSettings(sellUser.id, { appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01' });
  autoTradingRepo.updateLiveOrderSetting(sellUser.id, true);
  const state = { price: 47, cash: 0, balanceQuantity: 10, averagePrice: 50, symbol: 'LIVESELL', rankingTopSymbol: 'LIVESELL' };
  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(sellUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(sellUser.id, strategy.id);
      createHeldTradeWithBuy(sellUser.id, strategy, {
        symbol: 'LIVESELL', symbolName: 'Live Sell', liveOrderEnabled: true,
        tradeDate: '2026-05-18'
      });

      // tick1: -6%라 손절 트리거 → 매도 주문 접수(ACCEPTED). 아직 청산하지 않고 보유를 유지한다.
      await withMockedDate('2026-05-18T14:00:00Z', async () => {
        const sell = await service.evaluateStrategy(sellUser.id, strategy.id);
        assert.equal(sell.decision.decision, 'SELL');
        assert.equal(sell.decision.sellReason, 'STOP_LOSS');
        assert.equal(sell.order.status, 'ACCEPTED');
        assert.ok(/체결 확인/.test(sell.decision.reason));
      });
      const afterPlace = repo.getStrategy(sellUser.id, strategy.id);
      assert.equal(afterPlace.holdingSymbol, 'LIVESELL'); // 아직 보유 — 접수만으론 청산 안 함
      assert.equal(afterPlace.dayLockedOut, false);

      // tick2: KIS 체결조회가 FILLED(평균 체결가 46.50)를 돌려준다 → 실제 체결가로 청산 확정.
      state.orderHistory = [{ odno: 'ORD1', tot_ccld_qty: '10', nccs_qty: '0', avg_prvs: '46.50', sll_buy_dvsn_cd: '01' }];
      await withMockedDate('2026-05-18T14:00:30Z', async () => {
        const confirmed = await service.evaluateStrategy(sellUser.id, strategy.id);
        assert.equal(confirmed.decision.decision, 'SELL');
        assert.equal(confirmed.decision.sellReason, 'STOP_LOSS');
        assert.ok(/체결 확정/.test(confirmed.decision.reason));
      });
      const closed = repo.getStrategy(sellUser.id, strategy.id);
      assert.equal(closed.holdingSymbol, null);
      assert.equal(closed.dayLockedOut, true);
      const trade = repo.listTrades(sellUser.id, { strategyId: strategy.id }).find((t) => t.symbol === 'LIVESELL');
      assert.equal(trade.status, 'CLOSED');
      assert.equal(Number(trade.exitPrice), 46.5); // 판단 시점 현재가(47)가 아닌 실제 체결가로 기록
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(sellUser.id, false);
  }
});

test('실주문 손절 매도가 미체결로 오래 머물면 취소하고 더 공격적인 가격으로 재호가한다', async () => {
  const reqUser = createUser(db, 'us-rank-requote@example.com');
  credentialService.saveSettings(reqUser.id, { appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01' });
  autoTradingRepo.updateLiveOrderSetting(reqUser.id, true);
  const state = { price: 47, cash: 0, balanceQuantity: 10, averagePrice: 50, symbol: 'REQUOTE', rankingTopSymbol: 'REQUOTE' };
  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(reqUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(reqUser.id, strategy.id);
      createHeldTradeWithBuy(reqUser.id, strategy, {
        symbol: 'REQUOTE', symbolName: 'Requote', liveOrderEnabled: true,
        tradeDate: '2026-05-18'
      });

      // tick1: 손절 매도 접수.
      await withMockedDate('2026-05-18T14:00:00Z', async () => {
        const sell = await service.evaluateStrategy(reqUser.id, strategy.id);
        assert.equal(sell.decision.sellReason, 'STOP_LOSS');
        assert.equal(state.orderCalls, 1);
      });
      // 주문 created_at을 mock 시간축에 맞춰 결정적으로 덮어쓴다(SQLite는 실제 시계라 어긋남).
      const sellOrder = repo.listOrders(reqUser.id, { strategyId: strategy.id }).find((o) => o.side === 'SELL');
      db.prepare("UPDATE us_rank_orders SET created_at = ? WHERE id = ?").run('2026-05-18 14:00:00', sellOrder.id);

      // tick2(+30초): 아직 stale 아님 → 체결 대기.
      await withMockedDate('2026-05-18T14:00:30Z', async () => {
        const wait = await service.evaluateStrategy(reqUser.id, strategy.id);
        assert.equal(wait.decision.decision, 'SKIP');
        assert.ok(/체결 대기/.test(wait.decision.reason));
        assert.equal(state.orderCalls, 1); // 새 주문 없음
      });

      // tick3(+60초): stale → 취소하고 더 공격적인 가격으로 재호가(새 주문).
      await withMockedDate('2026-05-18T14:01:00Z', async () => {
        const requote = await service.evaluateStrategy(reqUser.id, strategy.id);
        assert.equal(requote.decision.decision, 'SELL');
        assert.ok(/재호가/.test(requote.decision.reason));
        assert.equal(state.cancelCalls, 1); // 직전 주문 취소됨
        assert.equal(state.orderCalls, 2); // 재호가 주문 발생
      });
      // 여전히 보유 — 재호가도 접수일 뿐 체결 확정은 다음 체결 확인에서.
      assert.equal(repo.getStrategy(reqUser.id, strategy.id).holdingSymbol, 'REQUOTE');
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(reqUser.id, false);
  }
});

test('실주문 미체결 지정가가 오래 머물면 취소하고 매매를 접는다', async () => {
  const liveUser = createUser(db, 'us-rank-stale@example.com');
  credentialService.saveSettings(liveUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(liveUser.id, true);
  const state = { price: 50, cash: 1000, balanceQuantity: 0, rankingTopSymbol: 'NOFILL', symbol: 'NOFILL' };
  await withMockedFetch(state, async () => {
    const strategy = service.createStrategy(liveUser.id, {
      targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
    });
    await service.startStrategy(liveUser.id, strategy.id);

    // 1) 첫 평가: 매수 주문 접수(ACCEPTED), 체결 0 → 보유 전환 안 됨.
    await withMockedDate('2026-05-21T15:00:00Z', async () => {
      const buy = await service.evaluateStrategy(liveUser.id, strategy.id);
      assert.equal(buy.decision.decision, 'BUY');
    });

    // withMockedDate는 JS Date만 mock하고 SQLite created_at(주문 시각)은 실제 시계라
    // 둘이 어긋난다. 주문 생성 시각을 mock 시간축(15:00:00Z)에 맞춰 결정적으로 덮어쓴다.
    const buyOrder = repo.listOrders(liveUser.id, { strategyId: strategy.id }).find((o) => o.side === 'BUY');
    db.prepare("UPDATE us_rank_orders SET created_at = ? WHERE id = ?").run('2026-05-21 15:00:00', buyOrder.id);

    // 2) 아직 stale 아님(주문 후 30초): 보류.
    await withMockedDate('2026-05-21T15:00:30Z', async () => {
      const wait = await service.evaluateStrategy(liveUser.id, strategy.id);
      assert.equal(wait.decision.decision, 'SKIP');
      assert.ok(/보류/.test(wait.decision.reason));
    });

    // 3) 4분 경과(체결 여전히 0): 취소하고 매매 FAILED 처리.
    await withMockedDate('2026-05-21T15:04:30Z', async () => {
      const cancelled = await service.evaluateStrategy(liveUser.id, strategy.id);
      assert.equal(cancelled.decision.decision, 'SKIP');
      assert.ok(/취소|접습니다/.test(cancelled.decision.reason));
    });
    const open = repo.getOpenTrade(strategy.id);
    assert.equal(open, null); // 열린 매매 없음 → 다음 tick 새 후보
  });
});

test('미국 랭킹: 사용자 설정이 켜져도 ENABLE_LIVE_ORDER=false이면 신규 진입은 DRY_RUN이다', async () => {
  const gateUser = createUser(db, 'us-rank-global-entry-gate@example.com');
  credentialService.saveSettings(gateUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(gateUser.id, true);
  const state = {
    price: 50,
    cash: 1_000,
    balanceQuantity: 0,
    rankingTopSymbol: 'GLOBALDRY',
    symbol: 'GLOBALDRY'
  };

  try {
    await withEnvOverride({ enableLiveOrder: 'false' }, async () => {
      await withMockedFetch(state, async () => {
        const strategy = service.createStrategy(gateUser.id, {
          targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
        });
        await service.startStrategy(gateUser.id, strategy.id);
        await withMockedDate('2026-05-21T15:00:00Z', async () => {
          const result = await service.evaluateStrategy(gateUser.id, strategy.id);
          assert.equal(result.decision.decision, 'BUY');
          assert.equal(result.decision.liveOrderEnabled, false);
          assert.equal(result.order.status, 'DRY_RUN');
          assert.equal(result.order.liveOrderEnabled, false);
        });
        assert.equal(state.orderCalls || 0, 0);
        assert.equal(state.cancelCalls || 0, 0);
      });
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(gateUser.id, false);
  }
});

test('미국 랭킹: live BUY 포지션은 사용자 토글을 꺼도 global ON에서 실매도로 청산한다', async () => {
  const liveUser = createUser(db, 'us-rank-live-position-user-off@example.com');
  credentialService.saveSettings(liveUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(liveUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 10,
    averagePrice: 50,
    symbol: 'LIVEPROV',
    rankingTopSymbol: 'LIVEPROV',
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(liveUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(liveUser.id, strategy.id);
      createHeldTradeWithBuy(liveUser.id, strategy, {
        symbol: 'LIVEPROV', symbolName: 'Live Provenance', liveOrderEnabled: true
      });
      autoTradingRepo.updateLiveOrderSetting(liveUser.id, false);

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(liveUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.decision.sellReason, 'STOP_LOSS');
        assert.equal(result.decision.liveOrderEnabled, true);
        assert.equal(result.order.status, 'ACCEPTED');
        assert.equal(result.order.liveOrderEnabled, true);
      });
      assert.equal(state.orderCalls, 1);
      assert.equal(repo.getStrategy(liveUser.id, strategy.id).holdingSymbol, 'LIVEPROV');
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(liveUser.id, false);
  }
});

test('미국 랭킹: DRY_RUN BUY 포지션은 사용자 토글을 켜도 실제 매도로 승격하지 않는다', async () => {
  const dryUser = createUser(db, 'us-rank-dry-position-user-on@example.com');
  credentialService.saveSettings(dryUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 0,
    averagePrice: 50,
    symbol: 'DRYPROV',
    rankingTopSymbol: 'DRYPROV'
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(dryUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(dryUser.id, strategy.id);
      createHeldTradeWithBuy(dryUser.id, strategy, {
        symbol: 'DRYPROV', symbolName: 'Dry Provenance', liveOrderEnabled: false
      });
      autoTradingRepo.updateLiveOrderSetting(dryUser.id, true);

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(dryUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.order.status, 'DRY_RUN');
        assert.equal(result.order.liveOrderEnabled, false);
      });
      assert.equal(state.orderCalls || 0, 0);
      assert.equal(state.cancelCalls || 0, 0);
      assert.equal(repo.getStrategy(dryUser.id, strategy.id).holdingSymbol, null);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(dryUser.id, false);
  }
});

test('미국 랭킹: global OFF에서는 오래된 live SELL을 취소·재호가·DRY_RUN 변환하지 않는다', async () => {
  const blockedUser = createUser(db, 'us-rank-global-working-sell@example.com');
  credentialService.saveSettings(blockedUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(blockedUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 10,
    averagePrice: 50,
    symbol: 'GLOBALHOLD',
    rankingTopSymbol: 'GLOBALHOLD',
    orderHistory: [],
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(blockedUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(blockedUser.id, strategy.id);
      const { trade } = createHeldTradeWithBuy(blockedUser.id, strategy, {
        symbol: 'GLOBALHOLD', symbolName: 'Global Hold', liveOrderEnabled: true
      });
      repo.updateTradeOutcome(trade.id, { status: 'BOUGHT', exitReason: 'STOP_LOSS' });
      const working = repo.createOrder(blockedUser.id, {
        strategyId: strategy.id,
        tradeId: trade.id,
        symbol: 'GLOBALHOLD',
        symbolName: 'Global Hold',
        exchange: 'NAS',
        side: 'SELL',
        sellReason: 'STOP_LOSS',
        quantity: 10,
        orderPrice: 47,
        estimatedAmount: 470,
        kisOrderNo: 'GLOBAL-WORKING-SELL-1',
        status: 'ACCEPTED',
        idempotencyKey: `US-${strategy.id}-${trade.id}-SELL`,
        decisionReason: 'global kill switch working sell',
        liveOrderEnabled: true
      });
      db.prepare("UPDATE us_rank_orders SET created_at = ? WHERE id = ?").run('2026-05-21 14:00:00', working.id);

      await withEnvOverride({ enableLiveOrder: 'false' }, async () => {
        await withMockedDate('2026-05-21T15:00:00Z', async () => {
          const result = await service.evaluateStrategy(blockedUser.id, strategy.id);
          assert.equal(result.decision.decision, 'SKIP');
          assert.match(result.decision.reason, /전역 실주문 차단/);
          assert.equal(result.decision.liveOrderEnabled, false);
        });
      });

      assert.equal(state.orderCalls || 0, 0);
      assert.equal(state.cancelCalls || 0, 0);
      assert.equal(repo.getOrder(blockedUser.id, working.id).status, 'ACCEPTED');
      assert.equal(repo.getStrategy(blockedUser.id, strategy.id).holdingSymbol, 'GLOBALHOLD');
      const sellOrders = repo.listOrders(blockedUser.id, { strategyId: strategy.id })
        .filter((order) => order.side === 'SELL');
      assert.equal(sellOrders.length, 1);
      assert.equal(sellOrders.some((order) => order.status === 'DRY_RUN'), false);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(blockedUser.id, false);
  }
});

test('미국 랭킹: global OFF fill sync는 live BUY 상태만 갱신하고 TARGET은 global ON 뒤 사용자 OFF여도 live로 생성한다', async () => {
  const syncUser = createUser(db, 'us-rank-global-fill-sync@example.com');
  credentialService.saveSettings(syncUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(syncUser.id, true);
  const state = {
    price: 50,
    cash: 0,
    balanceQuantity: 0,
    averagePrice: 50,
    symbol: 'SYNCPROV',
    rankingTopSymbol: 'SYNCPROV',
    orderHistory: [
      {
        odno: 'SYNC-LIVE-BUY-1',
        ovrs_pdno: 'SYNCPROV',
        sll_buy_dvsn_cd: '02',
        ft_ord_qty: '10',
        ft_ccld_qty: '4',
        nccs_qty: '6',
        ft_ccld_unpr3: '50'
      },
      {
        odno: 'SYNC-LIVE-BUY-CANCEL-1',
        orgn_odno: 'SYNC-LIVE-BUY-1',
        ovrs_pdno: 'SYNCPROV',
        sll_buy_dvsn_cd: '02',
        rvse_cncl_dvsn: '02',
        prcs_stat_name: '완료',
        ft_ord_qty: '6',
        ft_ccld_qty: '0',
        nccs_qty: '0',
        ft_ccld_unpr3: '0'
      }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(syncUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(syncUser.id, strategy.id);
      const trade = repo.createTrade(syncUser.id, {
        strategyId: strategy.id,
        tradeDate: '2026-05-21',
        tradeSeq: 1,
        symbol: 'SYNCPROV',
        symbolName: 'Sync Provenance',
        exchange: 'NAS',
        selectedPrice: 50,
        selectedFluctuationRate: 0.2,
        status: 'SELECTED'
      });
      const buy = repo.createOrder(syncUser.id, {
        strategyId: strategy.id,
        tradeId: trade.id,
        symbol: 'SYNCPROV',
        symbolName: 'Sync Provenance',
        exchange: 'NAS',
        side: 'BUY',
        quantity: 10,
        orderPrice: 50,
        estimatedAmount: 500,
        kisOrderNo: 'SYNC-LIVE-BUY-1',
        status: 'ACCEPTED',
        idempotencyKey: `20260521-${strategy.id}-1-BUY`,
        decisionReason: 'global fill sync provenance',
        liveOrderEnabled: true
      });

      await withEnvOverride({ enableLiveOrder: 'false' }, async () => {
        const updated = await service.syncOrderFills(syncUser.id, { strategyId: strategy.id });
        assert.equal(updated.length, 1);
        const syncedBuy = repo.getOrder(syncUser.id, buy.id);
        assert.equal(syncedBuy.status, 'CANCELED');
        assert.equal(syncedBuy.filledQuantity, 4);
        assert.equal(repo.listOrders(syncUser.id, { strategyId: strategy.id }).filter((order) => order.side === 'SELL').length, 0);
        assert.equal(state.orderCalls || 0, 0);
      });

      autoTradingRepo.updateLiveOrderSetting(syncUser.id, false);
      state.balanceQuantity = 4;
      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(syncUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /매수 체결 확인/);
        assert.equal(result.decision.liveOrderEnabled, true);
      });
      const target = repo.listOrders(syncUser.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
      assert.equal(target.status, 'ACCEPTED');
      assert.equal(target.liveOrderEnabled, true);
      assert.equal(target.quantity, 4);
      assert.equal(state.orderCalls, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(syncUser.id, false);
  }
});

test('미국 랭킹: TARGET 취소 요청이 KIS에서 확정되지 않으면 방어 SELL을 만들지 않는다', async () => {
  const cancelUser = createUser(db, 'us-rank-target-cancel-unconfirmed@example.com');
  credentialService.saveSettings(cancelUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(cancelUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 10,
    averagePrice: 50,
    symbol: 'TARGETWAIT',
    rankingTopSymbol: 'TARGETWAIT',
    confirmCancellation: false,
    openOrders: [{
      odno: 'TARGET-WAIT-1',
      ovrs_pdno: 'TARGETWAIT',
      ft_ord_qty: '10',
      ft_ccld_qty: '0',
      ft_nccs_qty: '10',
      sll_buy_dvsn_cd: '01'
    }]
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(cancelUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(cancelUser.id, strategy.id);
      const { trade, target } = createHeldTradeWithTarget(cancelUser.id, strategy, {
        symbol: 'TARGETWAIT',
        symbolName: 'Target Wait',
        orderNo: 'TARGET-WAIT-1',
        originalOrderNo: null
      });

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(cancelUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /취소 확정 상태가 아닙니다/);
      });
      assert.equal(state.cancelCalls, 1);
      assert.equal(state.orderCalls || 0, 0);
      assert.equal(repo.getOrder(cancelUser.id, target.id).status, 'ACCEPTED');
      assert.equal(repo.getTradeById(trade.id).exitReason, null);
      assert.equal(repo.getStrategy(cancelUser.id, strategy.id).holdingSymbol, 'TARGETWAIT');
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(cancelUser.id, false);
  }
});

test('미국 랭킹: stale SELL 취소가 KIS에서 확정되지 않으면 재호가하지 않는다', async () => {
  const cancelUser = createUser(db, 'us-rank-working-cancel-unconfirmed@example.com');
  credentialService.saveSettings(cancelUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(cancelUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 10,
    averagePrice: 50,
    symbol: 'SELLWAIT',
    rankingTopSymbol: 'SELLWAIT',
    confirmCancellation: false,
    openOrders: [{
      odno: 'SELL-WAIT-1',
      ovrs_pdno: 'SELLWAIT',
      ft_ord_qty: '10',
      ft_ccld_qty: '0',
      ft_nccs_qty: '10',
      sll_buy_dvsn_cd: '01'
    }]
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(cancelUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(cancelUser.id, strategy.id);
      const { trade } = createHeldTradeWithBuy(cancelUser.id, strategy, {
        symbol: 'SELLWAIT', symbolName: 'Sell Wait', liveOrderEnabled: true
      });
      repo.updateTradeOutcome(trade.id, { status: 'BOUGHT', exitReason: 'STOP_LOSS' });
      const working = repo.createOrder(cancelUser.id, {
        strategyId: strategy.id,
        tradeId: trade.id,
        symbol: 'SELLWAIT',
        symbolName: 'Sell Wait',
        exchange: 'NAS',
        side: 'SELL',
        sellReason: 'STOP_LOSS',
        quantity: 10,
        orderPrice: 47,
        estimatedAmount: 470,
        kisOrderNo: 'SELL-WAIT-1',
        status: 'ACCEPTED',
        idempotencyKey: `US-${strategy.id}-${trade.id}-SELL-WAIT`,
        decisionReason: '취소 확정 대기 테스트',
        liveOrderEnabled: true
      });
      db.prepare("UPDATE us_rank_orders SET created_at = ? WHERE id = ?").run('2026-05-21 14:00:00', working.id);

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(cancelUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /취소할 수 없어/);
      });
      assert.equal(state.cancelCalls, 1);
      assert.equal(state.orderCalls || 0, 0);
      assert.equal(repo.getOrder(cancelUser.id, working.id).status, 'ACCEPTED');
      assert.equal(repo.getTradeById(trade.id).status, 'BOUGHT');
      assert.equal(repo.getStrategy(cancelUser.id, strategy.id).holdingSymbol, 'SELLWAIT');
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(cancelUser.id, false);
  }
});

test('미국 랭킹: terminal 부분체결 BUY는 재매수를 막고 terminal 부분체결 SELL은 재호가를 허용한다', () => {
  const strategy = service.createStrategy(user.id, {
    targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
  });
  const trade = repo.createTrade(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-05-21',
    tradeSeq: 1,
    symbol: 'PARTIALTERM',
    symbolName: 'Partial Terminal',
    exchange: 'NAS',
    selectedPrice: 50,
    status: 'SELECTED'
  });
  const buyKey = `US-${strategy.id}-${trade.id}-PARTIAL-BUY`;
  const sellKey = `US-${strategy.id}-${trade.id}-PARTIAL-SELL`;
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, tradeId: trade.id, symbol: 'PARTIALTERM', symbolName: 'Partial Terminal',
    exchange: 'NAS', side: 'BUY', quantity: 10, orderPrice: 50, estimatedAmount: 500,
    status: 'CANCELED', filledQuantity: 4, remainingQuantity: 0,
    averageFilledPrice: 50, idempotencyKey: buyKey, decisionReason: '부분체결 매수', liveOrderEnabled: true
  });
  repo.createOrder(user.id, {
    strategyId: strategy.id, tradeId: trade.id, symbol: 'PARTIALTERM', symbolName: 'Partial Terminal',
    exchange: 'NAS', side: 'SELL', sellReason: 'STOP_LOSS', quantity: 10, orderPrice: 47, estimatedAmount: 470,
    status: 'CANCELED', filledQuantity: 4, remainingQuantity: 0,
    averageFilledPrice: 47, idempotencyKey: sellKey, decisionReason: '부분체결 매도', liveOrderEnabled: true
  });

  assert.equal(repo.hasNonFailedOrder(buyKey), true);
  assert.equal(repo.getActiveOrderByIdempotencyKey(buyKey).id, buy.id);
  assert.equal(repo.hasNonFailedOrder(sellKey), false);
  assert.equal(repo.getActiveOrderByIdempotencyKey(sellKey), null);
});

test('미국 랭킹: 부분체결 후 CANCELED된 방어 SELL은 전량 체결로 닫지 않고 남은 잔고만 재호가한다', async () => {
  const partialUser = createUser(db, 'us-rank-partial-canceled-sell@example.com');
  credentialService.saveSettings(partialUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(partialUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 6,
    averagePrice: 50,
    symbol: 'PARTSELL',
    rankingTopSymbol: 'PARTSELL',
    openOrders: [],
    orderHistory: [
      {
        odno: 'PARTIAL-SELL-1', ovrs_pdno: 'PARTSELL', sll_buy_dvsn_cd: '01',
        ft_ord_qty: '10', ft_ccld_qty: '4', nccs_qty: '6', ft_ccld_unpr3: '47'
      },
      {
        odno: 'PARTIAL-SELL-CANCEL-1', orgn_odno: 'PARTIAL-SELL-1', ovrs_pdno: 'PARTSELL',
        sll_buy_dvsn_cd: '01', rvse_cncl_dvsn: '02', prcs_stat_name: '완료',
        ft_ord_qty: '6', ft_ccld_qty: '0', nccs_qty: '0', ft_ccld_unpr3: '0'
      }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(partialUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(partialUser.id, strategy.id);
      const { trade } = createHeldTradeWithBuy(partialUser.id, strategy, {
        symbol: 'PARTSELL', symbolName: 'Partial Sell', liveOrderEnabled: true
      });
      repo.updateTradeOutcome(trade.id, { status: 'BOUGHT', exitReason: 'STOP_LOSS' });
      const firstSell = repo.createOrder(partialUser.id, {
        strategyId: strategy.id, tradeId: trade.id, symbol: 'PARTSELL', symbolName: 'Partial Sell',
        exchange: 'NAS', side: 'SELL', sellReason: 'STOP_LOSS', quantity: 10, orderPrice: 47,
        estimatedAmount: 470, kisOrderNo: 'PARTIAL-SELL-1', status: 'ACCEPTED',
        idempotencyKey: `20260521-${strategy.id}-1-SELL`, decisionReason: '부분체결 후 취소', liveOrderEnabled: true
      });

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(partialUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.order.status, 'ACCEPTED');
        assert.equal(result.order.quantity, 6);
      });
      const canceled = repo.getOrder(partialUser.id, firstSell.id);
      assert.equal(canceled.status, 'CANCELED');
      assert.equal(canceled.filledQuantity, 4);
      assert.equal(repo.getTradeById(trade.id).status, 'BOUGHT');
      assert.equal(repo.getStrategy(partialUser.id, strategy.id).holdingSymbol, 'PARTSELL');
      assert.equal(state.orderCalls, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(partialUser.id, false);
  }
});

test('미국 랭킹: 부분체결 후 CANCELED된 TARGET은 남은 잔고 수량으로 목표가 주문을 복구한다', async () => {
  const partialUser = createUser(db, 'us-rank-partial-canceled-target@example.com');
  credentialService.saveSettings(partialUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(partialUser.id, true);
  const state = {
    price: 50,
    cash: 0,
    balanceQuantity: 6,
    averagePrice: 50,
    symbol: 'PARTTARGET',
    rankingTopSymbol: 'PARTTARGET',
    openOrders: [],
    orderHistory: [
      {
        odno: 'PARTIAL-TARGET-1', ovrs_pdno: 'PARTTARGET', sll_buy_dvsn_cd: '01',
        ft_ord_qty: '10', ft_ccld_qty: '4', nccs_qty: '6', ft_ccld_unpr3: '51'
      },
      {
        odno: 'PARTIAL-TARGET-CANCEL-1', orgn_odno: 'PARTIAL-TARGET-1', ovrs_pdno: 'PARTTARGET',
        sll_buy_dvsn_cd: '01', rvse_cncl_dvsn: '02', prcs_stat_name: '완료',
        ft_ord_qty: '6', ft_ccld_qty: '0', nccs_qty: '0', ft_ccld_unpr3: '0'
      }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(partialUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(partialUser.id, strategy.id);
      const { trade, target } = createHeldTradeWithTarget(partialUser.id, strategy, {
        symbol: 'PARTTARGET', symbolName: 'Partial Target', orderNo: 'PARTIAL-TARGET-1', originalOrderNo: null
      });

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(partialUser.id, strategy.id);
        assert.equal(result.decision.decision, 'HOLD');
      });
      const canceled = repo.getOrder(partialUser.id, target.id);
      assert.equal(canceled.status, 'CANCELED');
      assert.equal(canceled.filledQuantity, 4);
      const replacement = repo.listOrders(partialUser.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET' && order.id !== target.id);
      assert.ok(replacement);
      assert.equal(replacement.status, 'ACCEPTED');
      assert.equal(replacement.quantity, 6);
      assert.equal(state.orderCalls, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(partialUser.id, false);
  }
});

test('미국 랭킹: TARGET 취소 중 부분체결되면 취소 전 수량이 아니라 재조회한 잔고만 방어 매도한다', async () => {
  const raceUser = createUser(db, 'us-rank-target-cancel-partial-race@example.com');
  credentialService.saveSettings(raceUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(raceUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 10,
    balanceAfterCancel: 6,
    averagePrice: 50,
    symbol: 'CANCELRACE',
    rankingTopSymbol: 'CANCELRACE',
    openOrders: [{
      odno: 'CANCEL-RACE-TARGET-1', ovrs_pdno: 'CANCELRACE',
      ft_ord_qty: '10', ft_ccld_qty: '4', ft_nccs_qty: '6', sll_buy_dvsn_cd: '01'
    }],
    orderHistory: [{
      odno: 'CANCEL-RACE-TARGET-1', ovrs_pdno: 'CANCELRACE', sll_buy_dvsn_cd: '01',
      ft_ord_qty: '10', ft_ccld_qty: '4', nccs_qty: '6', ft_ccld_unpr3: '51'
    }]
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(raceUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(raceUser.id, strategy.id);
      const { target } = createHeldTradeWithTarget(raceUser.id, strategy, {
        symbol: 'CANCELRACE', symbolName: 'Cancel Race', orderNo: 'CANCEL-RACE-TARGET-1', originalOrderNo: null
      });

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(raceUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.order.status, 'ACCEPTED');
        assert.equal(result.order.quantity, 6);
      });
      assert.equal(repo.getOrder(raceUser.id, target.id).status, 'CANCELED');
      assert.equal(repo.getOrder(raceUser.id, target.id).filledQuantity, 4);
      assert.equal(state.cancelCalls, 1);
      assert.equal(state.orderCalls, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(raceUser.id, false);
  }
});

test('미국 랭킹: 이전 거래일 terminal 부분체결 BUY 잔고는 폐기하지 않고 live 포지션으로 이어 관리한다', async () => {
  const staleUser = createUser(db, 'us-rank-stale-partial-buy@example.com');
  credentialService.saveSettings(staleUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(staleUser.id, true);
  const state = {
    price: 50,
    cash: 0,
    balanceQuantity: 4,
    averagePrice: 50,
    symbol: 'STALEPART',
    rankingTopSymbol: 'STALEPART',
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(staleUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(staleUser.id, strategy.id);
      const trade = repo.createTrade(staleUser.id, {
        strategyId: strategy.id,
        tradeDate: '2026-05-20',
        tradeSeq: 1,
        symbol: 'STALEPART',
        symbolName: 'Stale Partial',
        exchange: 'NAS',
        selectedPrice: 50,
        status: 'SELECTED'
      });
      repo.createOrder(staleUser.id, {
        strategyId: strategy.id, tradeId: trade.id, symbol: 'STALEPART', symbolName: 'Stale Partial',
        exchange: 'NAS', side: 'BUY', quantity: 10, orderPrice: 50, estimatedAmount: 500,
        kisOrderNo: 'STALE-PARTIAL-BUY-1', status: 'CANCELED', filledQuantity: 4,
        remainingQuantity: 0, averageFilledPrice: 50,
        idempotencyKey: `20260520-${strategy.id}-1-BUY`,
        decisionReason: '이전 거래일 부분체결', liveOrderEnabled: true
      });
      autoTradingRepo.updateLiveOrderSetting(staleUser.id, false);

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(staleUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /기존 live 포지션으로 관리/);
        assert.equal(result.decision.liveOrderEnabled, true);
      });
      assert.equal(repo.getTradeById(trade.id).status, 'BOUGHT');
      assert.equal(repo.getStrategy(staleUser.id, strategy.id).holdingSymbol, 'STALEPART');
      const target = repo.listOrders(staleUser.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
      assert.ok(target);
      assert.equal(target.quantity, 4);
      assert.equal(target.liveOrderEnabled, true);
      assert.equal(state.orderCalls, 1);
      assert.equal(state.cancelCalls || 0, 0);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(staleUser.id, false);
  }
});

test('미국 랭킹: 주문 응답 timeout은 UNKNOWN intent를 남겨 같은 BUY 자동 재전송을 막는다', async () => {
  const timeoutUser = createUser(db, 'us-rank-order-timeout@example.com');
  credentialService.saveSettings(timeoutUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(timeoutUser.id, true);
  const state = {
    price: 50,
    cash: 1_000,
    balanceQuantity: 0,
    symbol: 'TIMEOUTBUY',
    rankingTopSymbol: 'TIMEOUTBUY',
    openOrders: [],
    orderNetworkError: true
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(timeoutUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(timeoutUser.id, strategy.id);

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const attempted = await service.evaluateStrategy(timeoutUser.id, strategy.id);
        assert.equal(attempted.order.status, 'UNKNOWN');
        assert.match(attempted.decision.reason, /자동 재전송을 막았습니다/);
      });
      await withMockedDate('2026-05-21T15:00:30Z', async () => {
        const next = await service.evaluateStrategy(timeoutUser.id, strategy.id);
        assert.equal(next.decision.decision, 'SKIP');
      });

      const buys = repo.listOrders(timeoutUser.id, { strategyId: strategy.id })
        .filter((order) => order.side === 'BUY');
      assert.equal(buys.length, 1);
      assert.equal(buys[0].status, 'UNKNOWN');
      assert.equal(state.orderCalls, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(timeoutUser.id, false);
  }
});

test('미국 랭킹: 신규 live BUY 전 동일 종목 외부 보유 10주가 있으면 주문을 차단한다', async () => {
  const preownedUser = createUser(db, 'us-rank-preowned-buy-gate@example.com');
  credentialService.saveSettings(preownedUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(preownedUser.id, true);
  const state = {
    price: 50,
    cash: 1_000,
    balanceQuantity: 10,
    averagePrice: 40,
    symbol: 'PREOWNED',
    rankingTopSymbol: 'PREOWNED',
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(preownedUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(preownedUser.id, strategy.id);

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(preownedUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /기존 보유 10주.*신규 실매수를 차단/);
        assert.equal(result.order, null);
      });

      const buys = repo.listOrders(preownedUser.id, { strategyId: strategy.id })
        .filter((order) => order.side === 'BUY');
      assert.equal(buys.length, 0);
      assert.equal(state.orderCalls || 0, 0);
      assert.equal(repo.getStrategy(preownedUser.id, strategy.id).holdingSymbol, null);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(preownedUser.id, false);
  }
});

test('미국 랭킹: BUY 체결 확인은 계좌 전체 잔고가 아니라 해당 주문수량으로 제한한다', async () => {
  const cappedUser = createUser(db, 'us-rank-buy-quantity-cap@example.com');
  credentialService.saveSettings(cappedUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(cappedUser.id, true);
  const state = {
    price: 50,
    cash: 1_000,
    balanceQuantity: 0,
    averagePrice: 50,
    symbol: 'BUYCAP',
    rankingTopSymbol: 'BUYCAP',
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(cappedUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(cappedUser.id, strategy.id);

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const placed = await service.evaluateStrategy(cappedUser.id, strategy.id);
        assert.equal(placed.order.quantity, 20);
      });
      // 주문 뒤 같은 종목 외부 보유가 더해져 계좌에는 30주가 보여도 이 BUY의 상한은 20주다.
      state.balanceQuantity = 30;
      await withMockedDate('2026-05-21T15:00:30Z', async () => {
        const confirmed = await service.evaluateStrategy(cappedUser.id, strategy.id);
        assert.match(confirmed.decision.reason, /매수 체결 확인\(20주/);
      });

      const held = repo.getStrategy(cappedUser.id, strategy.id);
      assert.equal(held.holdingQuantity, 20);
      const target = repo.listOrders(cappedUser.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
      assert.ok(target);
      assert.equal(target.quantity, 20);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(cappedUser.id, false);
  }
});

test('미국 랭킹: SELL은 외부 보유분을 제외한 전략 BUY 관리수량만 주문한다', async () => {
  const managedUser = createUser(db, 'us-rank-managed-sell-cap@example.com');
  credentialService.saveSettings(managedUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(managedUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 20,
    averagePrice: 50,
    symbol: 'SELLCAP',
    rankingTopSymbol: 'SELLCAP',
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(managedUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(managedUser.id, strategy.id);
      createHeldTradeWithBuy(managedUser.id, strategy, {
        symbol: 'SELLCAP', symbolName: 'Sell Cap', liveOrderEnabled: true
      });

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(managedUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.order.quantity, 10);
      });
      assert.equal(state.orderCalls, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(managedUser.id, false);
  }
});

test('미국 랭킹: 이전 SELL 4주 체결 뒤 외부 잔고가 섞여도 관리 잔량 6주만 재매도한다', async () => {
  const residualUser = createUser(db, 'us-rank-managed-residual-sell@example.com');
  credentialService.saveSettings(residualUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(residualUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 16,
    averagePrice: 50,
    symbol: 'RESIDUAL',
    rankingTopSymbol: 'RESIDUAL',
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(residualUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(residualUser.id, strategy.id);
      const { trade } = createHeldTradeWithBuy(residualUser.id, strategy, {
        symbol: 'RESIDUAL', symbolName: 'Residual', liveOrderEnabled: true
      });
      repo.createOrder(residualUser.id, {
        strategyId: strategy.id, tradeId: trade.id,
        symbol: 'RESIDUAL', symbolName: 'Residual', exchange: 'NAS',
        side: 'SELL', sellReason: 'STOP_LOSS', quantity: 10, orderPrice: 47,
        estimatedAmount: 470, status: 'CANCELED', filledQuantity: 4, remainingQuantity: 0,
        averageFilledPrice: 47, idempotencyKey: `20260521-${strategy.id}-1-SELL`,
        decisionReason: '부분체결 뒤 취소', liveOrderEnabled: true
      });

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(residualUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.order.quantity, 6);
      });
      assert.equal(state.orderCalls, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(residualUser.id, false);
  }
});

test('미국 랭킹: 전일 ACCEPTED BUY는 DB 체결수량이 없어도 실제 잔고를 복구한다', async () => {
  const staleAcceptedUser = createUser(db, 'us-rank-stale-accepted-balance@example.com');
  credentialService.saveSettings(staleAcceptedUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(staleAcceptedUser.id, true);
  const state = {
    price: 50,
    cash: 0,
    balanceQuantity: 4,
    averagePrice: 50,
    symbol: 'STALEACCEPT',
    rankingTopSymbol: 'STALEACCEPT',
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(staleAcceptedUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(staleAcceptedUser.id, strategy.id);
      const trade = repo.createTrade(staleAcceptedUser.id, {
        strategyId: strategy.id, tradeDate: '2026-05-20', tradeSeq: 1,
        symbol: 'STALEACCEPT', symbolName: 'Stale Accepted', exchange: 'NAS',
        selectedPrice: 50, status: 'SELECTED'
      });
      repo.createOrder(staleAcceptedUser.id, {
        strategyId: strategy.id, tradeId: trade.id,
        symbol: 'STALEACCEPT', symbolName: 'Stale Accepted', exchange: 'NAS',
        side: 'BUY', quantity: 10, orderPrice: 50, estimatedAmount: 500,
        kisOrderNo: 'STALE-ACCEPTED-BUY-1', status: 'ACCEPTED',
        idempotencyKey: `20260520-${strategy.id}-1-BUY`,
        decisionReason: '전일 접수 상태', liveOrderEnabled: true
      });

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(staleAcceptedUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /기존 live 포지션으로 관리/);
        assert.equal(result.decision.holdingQuantity, 4);
      });
      assert.equal(repo.getTradeById(trade.id).status, 'BOUGHT');
      assert.equal(repo.getStrategy(staleAcceptedUser.id, strategy.id).holdingQuantity, 4);
      assert.equal(state.cancelCalls || 0, 0);
      const target = repo.listOrders(staleAcceptedUser.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
      assert.ok(target);
      assert.equal(target.quantity, 4);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(staleAcceptedUser.id, false);
  }
});

test('미국 랭킹: active BUY 일부체결은 잔량 취소 확정 뒤 체결분만 TARGET으로 보호한다', async () => {
  const partialBuyUser = createUser(db, 'us-rank-active-partial-buy-cancel@example.com');
  credentialService.saveSettings(partialBuyUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(partialBuyUser.id, true);
  const state = {
    price: 50,
    cash: 0,
    balanceQuantity: 4,
    balanceAfterCancel: 4,
    averagePrice: 50,
    symbol: 'PARTBUY',
    rankingTopSymbol: 'PARTBUY',
    openOrders: [{
      odno: 'ACTIVE-PARTIAL-BUY-1', ovrs_pdno: 'PARTBUY',
      ft_ord_qty: '10', ft_ccld_qty: '4', ft_nccs_qty: '6', sll_buy_dvsn_cd: '02'
    }],
    orderHistory: [{
      odno: 'ACTIVE-PARTIAL-BUY-1', ovrs_pdno: 'PARTBUY',
      ft_ord_qty: '10', ft_ccld_qty: '4', nccs_qty: '6',
      ft_ccld_unpr3: '50', sll_buy_dvsn_cd: '02'
    }]
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(partialBuyUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(partialBuyUser.id, strategy.id);
      const trade = repo.createTrade(partialBuyUser.id, {
        strategyId: strategy.id, tradeDate: '2026-05-21', tradeSeq: 1,
        symbol: 'PARTBUY', symbolName: 'Partial Buy', exchange: 'NAS',
        selectedPrice: 50, status: 'SELECTED'
      });
      repo.createOrder(partialBuyUser.id, {
        strategyId: strategy.id, tradeId: trade.id,
        symbol: 'PARTBUY', symbolName: 'Partial Buy', exchange: 'NAS',
        side: 'BUY', quantity: 10, orderPrice: 50, estimatedAmount: 500,
        kisOrderNo: 'ACTIVE-PARTIAL-BUY-1', status: 'ACCEPTED',
        idempotencyKey: `20260521-${strategy.id}-1-BUY`,
        decisionReason: '일부체결 매수', liveOrderEnabled: true
      });

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(partialBuyUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /남은 BUY 수량의 취소를 확인/);
        assert.equal(result.decision.holdingQuantity, 4);
      });
      assert.equal(state.cancelCalls, 1);
      const target = repo.listOrders(partialBuyUser.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
      assert.ok(target);
      assert.equal(target.quantity, 4);
      assert.equal(repo.getStrategy(partialBuyUser.id, strategy.id).holdingQuantity, 4);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(partialBuyUser.id, false);
  }
});

test('미국 랭킹: 체결 0으로 취소된 BUY의 과거 holding 수량으로 외부 잔고를 매도하지 않는다', async () => {
  const canceledBuyUser = createUser(db, 'us-rank-canceled-buy-external-balance@example.com');
  credentialService.saveSettings(canceledBuyUser.id, {
    appKey: 'app', appSecret: 'secret', accountNumber: '12345678', accountProductCode: '01'
  });
  autoTradingRepo.updateLiveOrderSetting(canceledBuyUser.id, true);
  const state = {
    price: 47,
    cash: 0,
    balanceQuantity: 10,
    averagePrice: 50,
    symbol: 'CANCELEDBUY',
    rankingTopSymbol: 'CANCELEDBUY',
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      const strategy = service.createStrategy(canceledBuyUser.id, {
        targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseKst: '04:30', exchange: 'NAS'
      });
      await service.startStrategy(canceledBuyUser.id, strategy.id);
      const { buy } = createHeldTradeWithBuy(canceledBuyUser.id, strategy, {
        symbol: 'CANCELEDBUY', symbolName: 'Canceled Buy', liveOrderEnabled: true
      });
      repo.updateOrder(canceledBuyUser.id, buy.id, {
        status: 'CANCELED', filledQuantity: null, remainingQuantity: 0,
        averageFilledPrice: null
      });

      await withMockedDate('2026-05-21T15:00:00Z', async () => {
        const result = await service.evaluateStrategy(canceledBuyUser.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.equal(result.order, null);
      });
      assert.equal(state.orderCalls || 0, 0);
      assert.equal(repo.getStrategy(canceledBuyUser.id, strategy.id).holdingSymbol, null);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(canceledBuyUser.id, false);
  }
});
