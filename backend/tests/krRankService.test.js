import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const service = await import('../src/services/krRankService.js');
const repo = await import('../src/repositories/krRankRepository.js');
const autoTradingRepo = await import('../src/repositories/autoTradingRepository.js');
const { env } = await import('../src/config/env.js');
const originalEnableLiveOrder = env.enableLiveOrder;
env.enableLiveOrder = 'true';

const user = createUser(db, 'kr-rank-service@example.com');
credentialService.saveSettings(user.id, {
  appKey: 'app-kr-rank',
  appSecret: 'secret-kr-rank',
  accountNumber: '12345678',
  accountProductCode: '01'
});

test.after(() => {
  env.enableLiveOrder = originalEnableLiveOrder;
  tmp.cleanup();
});

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

function withEnvOverride(patch, run) {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = env[key];
    env[key] = value;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) env[key] = value;
    });
}

function withMockedFetch(state, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const text = String(url);
    const parsed = new URL(text);
    if (text.endsWith('/oauth2/tokenP')) {
      return json({ rt_cd: '0', access_token: 'tok-kr-rank', expires_in: 3600 });
    }
    if (text.includes('/uapi/domestic-stock/v1/ranking/fluctuation')) {
      return json({
        rt_cd: '0',
        output: state.rankingRows || [
          { stck_shrn_iscd: '018260', hts_kor_isnm: '삼성에스디에스', stck_prpr: '286500', prdy_ctrt: '15.0' },
          { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '10.0' }
        ]
      });
    }
    if (text.includes('/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice')) {
      // 분봉 종가는 같은 종목의 현재가(inquire-price)와 같은 스케일이어야 진입 슬리피지 가드를 통과한다.
      const symbol = parsed.searchParams.get('FID_INPUT_ISCD');
      const minuteRows = state.minuteRows?.[symbol] || state.minuteRows;
      if (minuteRows) {
        return json({ rt_cd: '0', output2: minuteRows });
      }
      const base = state.prices?.[symbol] ?? 70_000;
      return json({ rt_cd: '0', output2: passingMinuteCandles(base) });
    }
    if (text.includes('/uapi/domestic-stock/v1/quotations/inquire-price')) {
      const symbol = parsed.searchParams.get('FID_INPUT_ISCD');
      const price = state.prices?.[symbol] ?? 70_000;
      return json({
        rt_cd: '0',
        output: {
          stck_prpr: String(price),
          stck_mxpr: String(price),
          hts_kor_isnm: symbol
        }
      });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-psbl-order')) {
      return json({ rt_cd: '0', output: { nrcvb_buy_amt: String(state.cash ?? 158_105), nrcvb_buy_qty: '999' } });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl')) {
      return json({ rt_cd: '0', output: [] });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-daily-ccld')) {
      state.historyCalls = (state.historyCalls || 0) + 1;
      return json({ rt_cd: '0', output1: state.history || [] });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-balance')) {
      return json({ rt_cd: '0', output1: state.holdings || [], output2: [{ dnca_tot_amt: String(state.cash ?? 0) }] });
    }
    if (options.method === 'POST' && text.includes('/uapi/domestic-stock/v1/trading/order-cash')) {
      state.orderCalls = (state.orderCalls || 0) + 1;
      return json({ rt_cd: '0', output: { ODNO: `KRO${state.orderCalls}` } });
    }
    return json({ rt_cd: '0', output: {} });
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function passingMinuteCandles(base = 70_000) {
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    // base 가격대를 중심으로 완만한 우상향. 마지막 완성봉 종가 ≈ base 라 진입 슬리피지 가드를 통과한다.
    const close = base * (1 - (9 - i) * 0.002);
    const minute = String(i).padStart(2, '0');
    out.push({
      stck_cntg_hour: `09${minute}00`,
      stck_oprc: String(Math.round(close * 0.999)),
      stck_hgpr: String(Math.round(close)),
      stck_lwpr: String(Math.round(close * 0.98)),
      stck_prpr: String(Math.round(close)),
      cntg_vol: '100000'
    });
  }
  return out.reverse();
}

function weakeningMinuteCandles() {
  return [
    ['113000', 5000, 5100, 4980, 5070, 12000],
    ['113100', 5070, 5120, 5050, 5100, 13000],
    ['113200', 5100, 5110, 5060, 5080, 11000],
    ['113300', 5080, 5080, 5000, 5030, 9000],
    ['113400', 5030, 5040, 4970, 4990, 8000],
    ['113500', 4990, 5000, 4920, 4950, 7000],
    ['113600', 4950, 4960, 4880, 4910, 5000],
    ['113700', 4910, 4920, 4840, 4870, 4000],
    ['113800', 4870, 4880, 4800, 4830, 3000],
    ['113900', 4830, 4840, 4760, 4790, 2000],
    ['114000', 4790, 4800, 4720, 4750, 1000]
  ].map(([time, open, high, low, close, volume]) => ({
    stck_cntg_hour: time,
    stck_oprc: String(open),
    stck_hgpr: String(high),
    stck_lwpr: String(low),
    stck_prpr: String(close),
    cntg_vol: String(volume)
  })).reverse();
}

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('한국 랭킹: 매수 체결과 목표 매도 체결이 한 tick 안에 끝나면 진입 기록을 BOUGHT로 굳혀 다음 tick부터 같은 SKIP을 반복하지 않는다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  // 9:10:58 KST 진입 tick에 evaluateEntryPath가 만들었던 상태 그대로 재현한다.
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-06-04', entryWindow: 'MORNING',
    status: 'SELECTED',
    selectedSymbol: '015260', selectedSymbolName: '동국홀딩스',
    selectedPrice: 5000, selectedFluctuationRate: 0.1,
    rankingSnapshot: null, bought: false
  });
  // 같은 tick 사이클에 BUY가 KIS에서 FILLED로 동기화됐다.
  repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '015260', symbolName: '동국홀딩스',
    side: 'BUY', entryWindow: 'MORNING', quantity: 222, orderPrice: 5000, estimatedAmount: 1_110_000,
    kisOrderNo: 'BUY-FAST-1', status: 'FILLED', filledQuantity: 222, averageFilledPrice: 5000,
    idempotencyKey: '20260604-' + strategy.id + '-MORNING-BUY',
    decisionReason: '단위 테스트', liveOrderEnabled: true
  });
  // TARGET 매도까지 같은 사이클에 체결돼 잔고는 0.
  repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '015260', symbolName: '동국홀딩스',
    side: 'SELL', sellReason: 'TARGET', entryWindow: 'MORNING', quantity: 222, orderPrice: 5100, estimatedAmount: 1_132_200,
    kisOrderNo: 'SELL-FAST-1', status: 'FILLED', filledQuantity: 222, averageFilledPrice: 5100,
    idempotencyKey: '20260604-' + strategy.id + '-MORNING-SELL-TARGET',
    decisionReason: '단위 테스트', liveOrderEnabled: true
  });

  await withMockedFetch({ cash: 0, prices: { '015260': 5100 } }, async () => {
    await withMockedDate('2026-06-04T00:15:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      // 반복되는 스케줄러 SKIP은 로그를 남기지 않지만 보유 상태는 NULL을 유지해야 한다.
      const refreshed = repo.getStrategy(user.id, strategy.id);
      assert.equal(refreshed.holdingSymbol, null);
      // 핵심: 진입 기록이 BOUGHT로 굳어졌는지 확인.
      const after = repo.getEntry(strategy.id, '2026-06-04', 'MORNING');
      assert.equal(after.bought, true);
      assert.equal(after.status, 'BOUGHT');
      assert.equal(result.decision, null);
    });

    // 다음 tick: 같은 시각에 다시 평가해도 line 191 조기 종료 분기에 빠져 매수 시도를 안 한다.
    await withMockedDate('2026-06-04T00:15:30Z', async () => {
      const second = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(second.decision, null);
      const orderCount = repo.listOrders(user.id, { strategyId: strategy.id }).length;
      assert.equal(orderCount, 2); // 새 매수가 추가되지 않아야 한다.
    });
  });

  autoTradingRepo.updateLiveOrderSetting(user.id, false);
});

test('한국 랭킹: 우리 DB의 BUY가 아직 ACCEPTED여도 KIS 체결조회로 FILLED가 확인되면 진입을 BOUGHT로 굳힌다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  // 평가 시작점의 syncOrderFills 가 KIS 일시 오류로 BUY 상태를 갱신하지 못한 시나리오를 재현한다.
  // 우리 DB 의 BUY 는 ACCEPTED, 잔고도 0 (TARGET 매도도 실제론 체결됐다고 가정).
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-06-05', entryWindow: 'MORNING',
    status: 'SELECTED',
    selectedSymbol: '015261', selectedSymbolName: '동국홀딩스B',
    selectedPrice: 5000, selectedFluctuationRate: 0.1,
    rankingSnapshot: null, bought: false
  });
  const idempotencyKey = '20260605-' + strategy.id + '-MORNING-BUY';
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '015261', symbolName: '동국홀딩스B',
    side: 'BUY', entryWindow: 'MORNING', quantity: 100, orderPrice: 5000, estimatedAmount: 500_000,
    kisOrderNo: 'BUY-STALE-1', status: 'ACCEPTED',
    idempotencyKey,
    decisionReason: '단위 테스트', liveOrderEnabled: true
  });

  // KIS 체결조회는 FILLED 로 응답한다 — 우리 DB 보다 KIS 가 최신.
  const state = {
    cash: 0,
    prices: { '015261': 5100 },
    history: [{
      odno: 'BUY-STALE-1', pdno: '015261', sll_buy_dvsn_cd: '02',
      ord_qty: '100', tot_ccld_qty: '100', nccs_qty: '0', avg_prvs: '5005'
    }]
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-05T00:15:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(result.decision, null);
    });
  });

  // 평가 분기에서 KIS 체결조회로 BUY 상태가 FILLED 로 보정됐고, 진입은 BOUGHT 로 굳었다.
  const refreshedOrder = repo.getOrder(user.id, buy.id);
  assert.equal(refreshedOrder.status, 'FILLED');
  assert.equal(Number(refreshedOrder.filledQuantity), 100);
  assert.equal(Number(refreshedOrder.averageFilledPrice), 5005);
  const refreshedEntry = repo.getEntry(strategy.id, '2026-06-05', 'MORNING');
  assert.equal(refreshedEntry.bought, true);
  assert.equal(refreshedEntry.status, 'BOUGHT');
  // 보유로 전환하진 않는다 — 매도까지 끝난 상태로 본다.
  const refreshedStrategy = repo.getStrategy(user.id, strategy.id);
  assert.equal(refreshedStrategy.holdingSymbol, null);
  // 평가 안에서 KIS 체결조회는 한 번만 호출된다(평가 시작점 syncOrderFills 1회 + 분기 보강 1회 = 최대 2회).
  assert.ok(state.historyCalls >= 1 && state.historyCalls <= 2);

  autoTradingRepo.updateLiveOrderSetting(user.id, false);
});

test('한국 랭킹: KIS 체결조회도 미체결로 응답하면 SKIP "보유 전환을 보류" 메시지로 끝낸다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-06-08', entryWindow: 'MORNING',
    status: 'SELECTED',
    selectedSymbol: '015262', selectedSymbolName: '동국홀딩스C',
    selectedPrice: 5000, selectedFluctuationRate: 0.1,
    rankingSnapshot: null, bought: false
  });
  repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '015262', symbolName: '동국홀딩스C',
    side: 'BUY', entryWindow: 'MORNING', quantity: 100, orderPrice: 5000, estimatedAmount: 500_000,
    kisOrderNo: 'BUY-WAIT-1', status: 'ACCEPTED',
    idempotencyKey: '20260608-' + strategy.id + '-MORNING-BUY',
    decisionReason: '단위 테스트', liveOrderEnabled: true
  });

  // KIS 체결조회도 미체결로 응답한다.
  const state = {
    cash: 0,
    prices: { '015262': 5000 },
    history: [{
      odno: 'BUY-WAIT-1', pdno: '015262', sll_buy_dvsn_cd: '02',
      ord_qty: '100', tot_ccld_qty: '0', nccs_qty: '100', avg_prvs: '0'
    }]
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-08T00:15:00Z', async () => {
      await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
    });
  });

  // 진입 기록은 아직 BOUGHT 로 굳지 않는다 — 정말 아직 체결 전이기 때문.
  const after = repo.getEntry(strategy.id, '2026-06-08', 'MORNING');
  assert.equal(after.bought, false);
  assert.equal(after.status, 'SELECTED');

  autoTradingRepo.updateLiveOrderSetting(user.id, false);
});

test('한국 랭킹: 목표가 주문이 오래 미체결이고 흐름이 무너지면 중기 방어 매도하며 entry_id를 연결한다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: true,
    lunchBudget: 1_000_000,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, false);
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-06-17', entryWindow: 'LUNCH',
    status: 'BOUGHT',
    selectedSymbol: '396300', selectedSymbolName: '세아메카닉스',
    selectedPrice: 5050, selectedFluctuationRate: 0.14,
    rankingSnapshot: null, bought: true
  });
  repo.setHolding(user.id, strategy.id, {
    symbol: '396300',
    symbolName: '세아메카닉스',
    entryWindow: 'LUNCH'
  });
  repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '396300', symbolName: '세아메카닉스',
    side: 'BUY', entryWindow: 'LUNCH', quantity: 20, orderPrice: 5050, estimatedAmount: 101_000,
    status: 'FILLED', filledQuantity: 20, remainingQuantity: 0, averageFilledPrice: 5050,
    idempotencyKey: '20260617-' + strategy.id + '-LUNCH-BUY',
    decisionReason: '단위 테스트', liveOrderEnabled: false
  });
  const target = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '396300', symbolName: '세아메카닉스',
    side: 'SELL', sellReason: 'TARGET', entryWindow: 'LUNCH', quantity: 20, orderPrice: 5151, estimatedAmount: 103_020,
    status: 'DECIDED',
    idempotencyKey: '20260617-' + strategy.id + '-LUNCH-SELL-TARGET',
    decisionReason: '단위 테스트', liveOrderEnabled: false
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-06-17 02:30:00', updated_at = '2026-06-17 02:30:00' WHERE id = ?")
    .run(target.id);

  await withMockedFetch({
    prices: { '396300': 4880 },
    minuteRows: { '396300': weakeningMinuteCandles() },
    holdings: [{
      pdno: '396300',
      hldg_qty: '20',
      pchs_avg_pric: '5050',
      prpr: '4880'
    }]
  }, async () => {
    await withMockedDate('2026-06-17T04:00:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(result.decision.decision, 'SELL');
      assert.equal(result.decision.sellReason, 'STOP_LOSS');
      assert.match(result.decision.reason, /중기 방어 손절/);
      assert.equal(result.order.entryId, entry.id);
      assert.equal(result.order.sellReason, 'STOP_LOSS');
      assert.equal(result.order.status, 'DRY_RUN');
    });
  });

  const canceledTarget = repo.getOrder(user.id, target.id);
  assert.equal(canceledTarget.status, 'CANCELED');

  autoTradingRepo.updateLiveOrderSetting(user.id, false);
});

test('한국 랭킹은 매수가능금액으로 1주도 못 사는 후보를 건너뛰고 다음 후보를 산다', async () => {
  await withMockedFetch({
    cash: 158_105,
    prices: { '018260': 286_500, '005930': 70_000 }
  }, async () => {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: true,
      morningBudget: 0,
      morningTargetProfitRate: 0.02,
      morningStopLossRate: 0.05,
      lunchEntryEnabled: false,
      lunchBudget: 0,
      lunchTargetProfitRate: 0.02,
      lunchStopLossRate: 0.05
    });
    await service.startStrategy(user.id, strategy.id);
    await withMockedDate('2026-05-29T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'BUY');
      assert.equal(result.decision.selectedSymbol, '005930');
      assert.equal(result.decision.expectedQuantity, 2);
      assert.equal(result.order.symbol, '005930');
      const target = repo.listOrders(user.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
      assert.equal(target.status, 'DECIDED');
      assert.equal(target.liveOrderEnabled, false);
    });
  });
});

test('한국 랭킹 스케줄러: 진입 구간 밖 idle SKIP은 판단 로그를 남기지 않는다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  const before = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 }).length;

  await withMockedDate('2026-06-08T01:30:00Z', async () => {
    const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
    assert.equal(result.decision, null);
  });

  const after = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 }).length;
  assert.equal(after, before);
});

test('한국 랭킹 스케줄러: 09:00~09:10 사전 관찰 구간에는 매수하지 않고 랭킹만 저장한다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  const beforeLogs = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 }).length;
  const state = { cash: 1_000_000, prices: { '005930': 70_000 } };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-08T00:05:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(result.decision, null);
      assert.equal(state.orderCalls || 0, 0);
    });
  });

  const observations = repo.listObservations(strategy.id, '2026-06-08', 'MORNING');
  assert.equal(observations.length, 1);
  assert.equal(observations[0].rankingSnapshot[0].symbol, '018260');
  const afterLogs = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 }).length;
  assert.equal(afterLogs, beforeLogs);
});

test('한국 랭킹: 사전 관찰에 반복 등장한 후보를 진입 시점에 매수한다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  repo.createObservation(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-08',
    entryWindow: 'MORNING',
    rankingSnapshot: [
      { symbol: '111111', name: '일회성', price: 10_000, fluctuationRate: 0.18 },
      { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.10 }
    ]
  });
  repo.createObservation(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-08',
    entryWindow: 'MORNING',
    rankingSnapshot: [
      { symbol: '222222', name: '교체', price: 12_000, fluctuationRate: 0.17 },
      { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.11 }
    ]
  });
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000, '333333': 10_000 },
    rankingRows: [
      { stck_shrn_iscd: '333333', hts_kor_isnm: '최신급등', stck_prpr: '10000', prdy_ctrt: '18.0' },
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '12.0' }
    ]
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-08T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(result.decision.decision, 'BUY');
      assert.equal(result.decision.selectedSymbol, '005930');
      assert.equal(result.order.symbol, '005930');
    });
  });
});

test('한국 랭킹 수동 평가: 진입 구간 밖 SKIP은 판단 로그를 남긴다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  const before = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 }).length;

  await withMockedDate('2026-06-08T01:30:00Z', async () => {
    const result = await service.evaluateStrategy(user.id, strategy.id);
    assert.equal(result.decision.decision, 'SKIP');
    assert.equal(result.decision.evaluationSource, 'MANUAL');
    assert.match(result.decision.reason, /진입 구간이 아니라/);
  });

  const after = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 }).length;
  assert.equal(after, before + 1);
});

test('한국 랭킹 스케줄러: 이미 평가 중인 idle SKIP은 판단 로그를 남기지 않는다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  const before = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 }).length;
  repo.acquireLock(user.id, strategy.id, 'evaluate', new Date(Date.now() + 60_000).toISOString());

  try {
    const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
    assert.equal(result.decision, null);
  } finally {
    repo.releaseLock(strategy.id, 'evaluate');
  }

  const after = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 }).length;
  assert.equal(after, before);
});

test('한국 랭킹 스케줄러: 후보가 전부 탈락한 SKIP도 판단 로그를 남긴다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);

  await withMockedFetch({
    rankingRows: [
      { stck_shrn_iscd: '018260', hts_kor_isnm: '삼성에스디에스', stck_prpr: '286500', prdy_ctrt: '25.0' },
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '21.0' }
    ],
    cash: 1_000_000
  }, async () => {
    await withMockedDate('2026-06-08T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(result.decision.decision, 'SKIP');
      assert.equal(result.decision.entryWindow, 'MORNING');
      assert.match(result.decision.reason, /매수 대상이 없어/);
    });
  });

  const logs = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 });
  assert.equal(logs[0].decision, 'SKIP');
  assert.equal(logs[0].entryWindow, 'MORNING');
  assert.match(logs[0].reason, /매수 대상이 없어/);

  autoTradingRepo.updateLiveOrderSetting(user.id, false);
});

test('한국 랭킹: DB 실주문 설정이 켜져도 ENABLE_LIVE_ORDER=false이면 DRY_RUN으로만 기록한다', async () => {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false
  });
  repo.startStrategy(user.id, strategy.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = { cash: 1_000_000, prices: { '005930': 70_000 } };

  await withEnvOverride({ enableLiveOrder: 'false' }, async () => {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-06-09T00:10:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
        assert.equal(result.decision.decision, 'BUY');
        assert.equal(result.decision.liveOrderEnabled, false);
        assert.equal(result.order.status, 'DRY_RUN');
        assert.equal(result.order.liveOrderEnabled, false);
      });
    });
  });

  assert.equal(state.orderCalls || 0, 0);

  autoTradingRepo.updateLiveOrderSetting(user.id, false);
});
