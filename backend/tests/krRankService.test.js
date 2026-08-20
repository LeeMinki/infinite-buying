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
const originalKrRankLiveEntryRetryEnabled = env.krRankLiveEntryRetryEnabled;
env.enableLiveOrder = 'true';
env.krRankLiveEntryRetryEnabled = true;

const user = createUser(db, 'kr-rank-service@example.com');
credentialService.saveSettings(user.id, {
  appKey: 'app-kr-rank',
  appSecret: 'secret-kr-rank',
  accountNumber: '12345678',
  accountProductCode: '01'
});

test.after(() => {
  env.enableLiveOrder = originalEnableLiveOrder;
  env.krRankLiveEntryRetryEnabled = originalKrRankLiveEntryRetryEnabled;
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
      state.rankingCalls = (state.rankingCalls || 0) + 1;
      return json({
        rt_cd: '0',
        output: state.rankingRows || [
          { stck_shrn_iscd: '018260', hts_kor_isnm: '삼성에스디에스', stck_prpr: '286500', prdy_ctrt: '15.0' },
          { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
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
      if (state.openOrdersError) {
        return json({ rt_cd: '1', msg_cd: 'TEST_OPEN_ORDERS', msg1: '미체결 조회 실패' });
      }
      const openOrders = state.cancelCalls > 0 && state.openOrdersAfterCancel
        ? state.openOrdersAfterCancel
        : state.openOrders;
      return json({ rt_cd: '0', output: openOrders || [] });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-daily-ccld')) {
      state.historyCalls = (state.historyCalls || 0) + 1;
      const history = state.cancelCalls > 0 && state.historyAfterCancel
        ? state.historyAfterCancel
        : state.history;
      return json({ rt_cd: '0', output1: history || [] });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-balance')) {
      return json({ rt_cd: '0', output1: state.holdings || [], output2: [{ dnca_tot_amt: String(state.cash ?? 0) }] });
    }
    if (options.method === 'POST' && text.includes('/uapi/domestic-stock/v1/trading/order-rvsecncl')) {
      state.cancelCalls = (state.cancelCalls || 0) + 1;
      return json({ rt_cd: '0', output: { ODNO: `KRC${state.cancelCalls}` } });
    }
    if (options.method === 'POST' && text.includes('/uapi/domestic-stock/v1/trading/order-cash')) {
      state.orderCalls = (state.orderCalls || 0) + 1;
      state.orderBodies = [...(state.orderBodies || []), JSON.parse(options.body || '{}')];
      if (state.orderNetworkError) throw new Error('simulated order response timeout');
      if (state.orderBusinessReject) {
        return json({
          rt_cd: '1',
          msg_cd: state.orderRejectCode || 'APBK0506',
          msg1: state.orderRejectCode === 'EGW00201' ? '초당 거래건수 초과' : '주문단가 오류'
        });
      }
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

function shakeoutMinuteCandles() {
  return [
    ['090000', 2360, 2410, 2360, 2410, 893],
    ['090100', 2425, 2580, 2425, 2580, 2919],
    ['091000', 2540, 2600, 2530, 2575, 2638],
    ['091100', 2565, 2575, 2560, 2575, 126],
    ['091200', 2575, 2575, 2415, 2420, 960]
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

function createRunningStrategy(overrides = {}) {
  const strategy = repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: 0.02,
    lunchStopLossRate: 0.05,
    autoBudgetEnabled: false,
    ...overrides
  });
  repo.startStrategy(user.id, strategy.id);
  return strategy;
}

function seedStableObservations(strategy, tradeDate, entryWindow = 'MORNING', rankingSnapshot = [
  { symbol: '018260', name: '삼성에스디에스', price: 286_500, fluctuationRate: 0.15 },
  { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.16 }
]) {
  for (let i = 0; i < 2; i += 1) {
    repo.createObservation(user.id, {
      strategyId: strategy.id,
      tradeDate,
      entryWindow,
      rankingSnapshot
    });
  }
}

function createLiveFilledExit(strategy, {
  symbol,
  sellReason,
  realizedProfitAmount,
  realizedProfitRate,
  filledAt,
  entryWindow = 'MORNING'
}) {
  const order = repo.createOrder(user.id, {
    strategyId: strategy.id,
    symbol,
    symbolName: symbol,
    side: 'SELL',
    sellReason,
    entryWindow,
    quantity: 1,
    orderPrice: 1_000,
    estimatedAmount: 1_000,
    kisOrderNo: `FILLED-${symbol}`,
    status: 'FILLED',
    filledQuantity: 1,
    remainingQuantity: 0,
    averageFilledPrice: 1_000,
    idempotencyKey: `${filledAt}-${strategy.id}-${entryWindow}-${symbol}-SELL`,
    decisionReason: '손실 회로 차단기 테스트',
    liveOrderEnabled: true
  });
  repo.updateOrderRealizedProfit(user.id, order.id, {
    realizedProfitAmount,
    realizedProfitRate,
    realizedProfitSource: 'TEST'
  });
  db.prepare('UPDATE kr_rank_orders SET created_at = ?, updated_at = ?, filled_at = ? WHERE id = ?')
    .run(filledAt, filledAt, filledAt, order.id);
  return repo.getOrder(user.id, order.id);
}

function createLiveFilledBuy(strategy, {
  symbol,
  quantity = 10,
  averageFilledPrice = 70_000,
  entryId = null,
  entryWindow = 'MORNING'
}) {
  const order = repo.createOrder(user.id, {
    strategyId: strategy.id,
    entryId,
    symbol,
    symbolName: symbol,
    side: 'BUY',
    entryWindow,
    quantity,
    orderPrice: averageFilledPrice,
    estimatedAmount: quantity * averageFilledPrice,
    kisOrderNo: `FILLED-BUY-${strategy.id}-${symbol}`,
    status: 'FILLED',
    filledQuantity: quantity,
    remainingQuantity: 0,
    averageFilledPrice,
    idempotencyKey: `FILLED-BUY-${strategy.id}-${entryWindow}-${symbol}`,
    decisionReason: '전략 보유 수량 증거 테스트',
    liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-01-01 00:00:00', updated_at = '2026-01-01 00:00:00' WHERE id = ?")
    .run(order.id);
  return repo.getOrder(user.id, order.id);
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

test('한국 랭킹: BUY FILLED와 잔고 0만으로 SELL 체결을 추정하지 않고 진입 확정을 보류한다', async () => {
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
  // 우리 DB의 BUY는 ACCEPTED였지만 KIS 조회에서 FILLED가 됐다. 잔고는 0이고 SELL 체결 증거는 없다.
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
      assert.equal(result.decision.decision, 'SKIP');
      assert.match(result.decision.reason, /매도 체결은 확인되지 않아 상태 확정을 보류/);
    });
  });

  // BUY 상태만 보정하고, SELL FILLED 증거가 없으므로 진입은 SELECTED로 남긴다.
  const refreshedOrder = repo.getOrder(user.id, buy.id);
  assert.equal(refreshedOrder.status, 'FILLED');
  assert.equal(Number(refreshedOrder.filledQuantity), 100);
  assert.equal(Number(refreshedOrder.averageFilledPrice), 5005);
  const refreshedEntry = repo.getEntry(strategy.id, '2026-06-05', 'MORNING');
  assert.equal(refreshedEntry.bought, false);
  assert.equal(refreshedEntry.status, 'SELECTED');
  // 잔고와 SELL 증거가 모두 없으므로 보유/청산 어느 쪽도 추정하지 않는다.
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

test('한국 랭킹: 이미 live로 접수된 BUY는 사용자 설정을 꺼도 DRY_RUN으로 전환하지 않는다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-09',
    entryWindow: 'MORNING',
    status: 'SELECTED',
    selectedSymbol: '015263',
    selectedSymbolName: '라이브대기',
    selectedPrice: 5_000,
    selectedFluctuationRate: 0.10,
    bought: false
  });
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id,
    entryId: entry.id,
    symbol: '015263',
    symbolName: '라이브대기',
    side: 'BUY',
    entryWindow: 'MORNING',
    quantity: 100,
    orderPrice: 5_000,
    estimatedAmount: 500_000,
    kisOrderNo: 'LIVE-BUY-WAIT-1',
    status: 'ACCEPTED',
    idempotencyKey: `20260609-${strategy.id}-MORNING-BUY`,
    decisionReason: '실주문 모드 고정 테스트',
    liveOrderEnabled: true
  });
  autoTradingRepo.updateLiveOrderSetting(user.id, false);
  const state = {
    cash: 0,
    prices: { '015263': 5_000 },
    history: [{
      odno: 'LIVE-BUY-WAIT-1', pdno: '015263', sll_buy_dvsn_cd: '02',
      ord_qty: '100', tot_ccld_qty: '0', nccs_qty: '100', avg_prvs: '0'
    }]
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-09T00:15:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.match(result.decision.reason, /아직 체결되지 않아/);
      assert.equal(result.decision.liveOrderEnabled, true);
      assert.equal(result.order, null);
    });
  });

  const orders = repo.listOrders(user.id, { strategyId: strategy.id });
  assert.equal(orders.length, 1);
  assert.equal(repo.getOrder(user.id, buy.id).status, 'ACCEPTED');
  assert.equal(orders.some((order) => order.status === 'DRY_RUN'), false);
  assert.equal(state.orderCalls || 0, 0);
});

test('한국 랭킹: live 매수로 생긴 포지션은 사용자 설정을 꺼도 live 매도로 청산한다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-10',
    entryWindow: 'MORNING',
    status: 'BOUGHT',
    selectedSymbol: '015264',
    selectedSymbolName: '라이브보유',
    selectedPrice: 70_000,
    selectedFluctuationRate: 0.10,
    bought: true
  });
  repo.setHolding(user.id, strategy.id, {
    symbol: '015264',
    symbolName: '라이브보유',
    entryWindow: 'MORNING'
  });
  const liveBuy = repo.createOrder(user.id, {
    strategyId: strategy.id,
    entryId: entry.id,
    symbol: '015264',
    symbolName: '라이브보유',
    side: 'BUY',
    entryWindow: 'MORNING',
    quantity: 10,
    orderPrice: 70_000,
    estimatedAmount: 700_000,
    kisOrderNo: 'LIVE-POSITION-BUY-1',
    status: 'FILLED',
    filledQuantity: 10,
    remainingQuantity: 0,
    averageFilledPrice: 70_000,
    idempotencyKey: `20260610-${strategy.id}-MORNING-BUY`,
    decisionReason: '실주문 포지션',
    liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-06-10 00:00:00' WHERE id = ?").run(liveBuy.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, false);
  const state = {
    prices: { '015264': 65_000 },
    holdings: [{
      pdno: '015264', hldg_qty: '10', pchs_avg_pric: '70000', prpr: '65000'
    }],
    openOrders: []
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-10T00:20:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SELL');
      assert.equal(result.decision.sellReason, 'STOP_LOSS');
      assert.equal(result.decision.liveOrderEnabled, true);
      assert.equal(result.order.status, 'ACCEPTED');
      assert.equal(result.order.liveOrderEnabled, true);
      assert.equal(state.orderCalls, 1);
    });
  });
});

test('한국 랭킹: 기록 모드 매수 포지션은 설정을 켜도 실제 매도로 전환하지 않는다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-11',
    entryWindow: 'MORNING',
    status: 'BOUGHT',
    selectedSymbol: '015265',
    selectedSymbolName: '기록보유',
    selectedPrice: 70_000,
    selectedFluctuationRate: 0.10,
    bought: true
  });
  repo.setHolding(user.id, strategy.id, {
    symbol: '015265',
    symbolName: '기록보유',
    entryWindow: 'MORNING'
  });
  const dryRunBuy = repo.createOrder(user.id, {
    strategyId: strategy.id,
    entryId: entry.id,
    symbol: '015265',
    symbolName: '기록보유',
    side: 'BUY',
    entryWindow: 'MORNING',
    quantity: 10,
    orderPrice: 70_000,
    estimatedAmount: 700_000,
    status: 'DRY_RUN',
    filledQuantity: 10,
    remainingQuantity: 0,
    averageFilledPrice: 70_000,
    idempotencyKey: `20260611-${strategy.id}-MORNING-BUY`,
    decisionReason: '기록 모드 포지션',
    liveOrderEnabled: false
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-06-11 00:00:00' WHERE id = ?").run(dryRunBuy.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '015265': 65_000 },
    holdings: [{
      pdno: '015265', hldg_qty: '10', pchs_avg_pric: '70000', prpr: '65000'
    }]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-06-11T00:20:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.order.status, 'DRY_RUN');
        assert.equal(result.order.liveOrderEnabled, false);
        assert.equal(state.orderCalls || 0, 0);
      });
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
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
  const boughtOrder = repo.createOrder(user.id, {
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
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-06-17 02:30:00', updated_at = '2026-06-17 02:30:00' WHERE id = ?")
    .run(boughtOrder.id);

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

test('한국 랭킹: -5% 전에는 흔들기 유예를 유지하고 -5%에서 하드 손절한다', async () => {
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
  autoTradingRepo.updateLiveOrderSetting(user.id, false);
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-06-18', entryWindow: 'MORNING',
    status: 'BOUGHT',
    selectedSymbol: '365900', selectedSymbolName: '브이씨',
    selectedPrice: 2575, selectedFluctuationRate: 0.0962,
    rankingSnapshot: null, bought: true
  });
  repo.setHolding(user.id, strategy.id, {
    symbol: '365900',
    symbolName: '브이씨',
    entryWindow: 'MORNING'
  });
  repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '365900', symbolName: '브이씨',
    side: 'BUY', entryWindow: 'MORNING', quantity: 43, orderPrice: 2576, estimatedAmount: 110_768,
    status: 'FILLED', filledQuantity: 43, remainingQuantity: 0, averageFilledPrice: 2572,
    idempotencyKey: '20260618-' + strategy.id + '-MORNING-BUY',
    decisionReason: '단위 테스트', liveOrderEnabled: false
  });
  const target = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '365900', symbolName: '브이씨',
    side: 'SELL', sellReason: 'TARGET', entryWindow: 'MORNING', quantity: 43, orderPrice: 2624, estimatedAmount: 112_832,
    status: 'DECIDED',
    idempotencyKey: '20260618-' + strategy.id + '-MORNING-SELL-TARGET',
    decisionReason: '단위 테스트', liveOrderEnabled: false
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-06-18 00:11:29', updated_at = '2026-06-18 00:11:29' WHERE id = ?")
    .run(target.id);

  const market = {
    prices: { '365900': 2456 },
    minuteRows: { '365900': shakeoutMinuteCandles() },
    holdings: [{
      pdno: '365900',
      hldg_qty: '43',
      pchs_avg_pric: '2572',
      prpr: '2456'
    }]
  };
  await withMockedFetch(market, async () => {
    await withMockedDate('2026-06-18T00:12:56Z', async () => {
      const held = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(held.decision.decision, 'HOLD');
    });

    market.prices['365900'] = 2443;
    market.holdings[0].prpr = '2443';
    await withMockedDate('2026-06-18T00:13:26Z', async () => {
      const stopped = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(stopped.decision.decision, 'SELL');
      assert.equal(stopped.decision.sellReason, 'STOP_LOSS');
      assert.match(stopped.decision.reason, /하드 방어 손절/);
      assert.equal(stopped.order.status, 'DRY_RUN');
    });
  });

  const refreshedTarget = repo.getOrder(user.id, target.id);
  assert.equal(refreshedTarget.status, 'CANCELED');
  const stopLossOrder = repo.listOrders(user.id, { strategyId: strategy.id })
    .find((order) => order.side === 'SELL' && order.sellReason === 'STOP_LOSS');
  assert.equal(stopLossOrder.status, 'DRY_RUN');

  autoTradingRepo.updateLiveOrderSetting(user.id, false);
});

test('한국 랭킹은 매수 불가 후보를 건너뛰고 다음 후보를 선택한 뒤 다음 tick에 산다', async () => {
  const state = {
    cash: 158_105,
    prices: { '018260': 286_500, '005930': 70_000 }
  };
  await withMockedFetch(state, async () => {
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
    seedStableObservations(strategy, '2026-05-29');
    await withMockedDate('2026-05-29T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.equal(result.decision.selectedSymbol, '005930');
      assert.match(result.decision.reason, /후보를 선택했습니다/);
      assert.equal(result.order, null);
      assert.equal(state.orderCalls || 0, 0);
      const selected = repo.getEntry(strategy.id, '2026-05-29', 'MORNING');
      assert.equal(selected.status, 'SELECTED');
      assert.equal(selected.selectedSymbol, '005930');
    });
    await withMockedDate('2026-05-29T00:10:30Z', async () => {
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
  assert.equal(observations[0].rankingSnapshot[0].symbol, '005930');
  const afterLogs = repo.listDecisionLogs(user.id, strategy.id, { limit: 10, offset: 0 }).length;
  assert.equal(afterLogs, beforeLogs);
});

test('한국 랭킹: 반복 관찰 후보를 먼저 SELECTED로 두고 다음 tick 재검증 후 매수한다', async () => {
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
      { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.16 }
    ]
  });
  repo.createObservation(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-08',
    entryWindow: 'MORNING',
    rankingSnapshot: [
      { symbol: '222222', name: '교체', price: 12_000, fluctuationRate: 0.17 },
      { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.16 }
    ]
  });
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000, '333333': 10_000 },
    rankingRows: [
      { stck_shrn_iscd: '333333', hts_kor_isnm: '최신급등', stck_prpr: '10000', prdy_ctrt: '18.0' },
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
    ]
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-08T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(result.decision.decision, 'SKIP');
      assert.equal(result.decision.selectedSymbol, '005930');
      assert.match(result.decision.reason, /다음 평가에서.*다시 확인/);
      assert.equal(result.order, null);
      assert.equal(state.orderCalls || 0, 0);
      const selected = repo.getEntry(strategy.id, '2026-06-08', 'MORNING');
      assert.equal(selected.status, 'SELECTED');
      assert.equal(selected.selectedSymbol, '005930');
    });
    await withMockedDate('2026-06-08T00:10:30Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
      assert.equal(result.decision.decision, 'BUY');
      assert.equal(result.decision.selectedSymbol, '005930');
      assert.equal(result.order.symbol, '005930');
    });
  });
});

test('한국 랭킹: 미체결 조회에 실패하면 실주문을 보내지 않고 다음 평가를 기다린다', async () => {
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
  seedStableObservations(strategy, '2026-06-10');
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    cash: 1_000_000,
    prices: { '018260': 286_500, '005930': 70_000 },
    openOrdersError: true
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-06-10T00:10:00Z', async () => {
        const selected = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(selected.decision.decision, 'SKIP');
        assert.match(selected.decision.reason, /후보를 선택했습니다/);
        assert.equal(selected.order, null);
        assert.equal(state.orderCalls || 0, 0);
      });
      await withMockedDate('2026-06-10T00:10:30Z', async () => {
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

test('한국 랭킹: 방어 매도 전 미체결 조회가 실패하면 기존 TARGET을 취소하지 않는다', async () => {
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
  repo.setHolding(user.id, strategy.id, {
    symbol: '005930',
    symbolName: '삼성전자',
    entryWindow: 'MORNING'
  });
  createLiveFilledBuy(strategy, { symbol: '005930' });
  const target = repo.createOrder(user.id, {
    strategyId: strategy.id,
    symbol: '005930',
    symbolName: '삼성전자',
    side: 'SELL',
    sellReason: 'TARGET',
    entryWindow: 'MORNING',
    quantity: 10,
    orderPrice: 71_400,
    estimatedAmount: 714_000,
    kisOrderNo: 'TARGET-FAIL-CLOSED',
    kisOriginalOrderNo: 'TARGET-ORIGINAL',
    status: 'ACCEPTED',
    remainingQuantity: 10,
    idempotencyKey: `20260610-${strategy.id}-MORNING-SELL-TARGET`,
    decisionReason: '목표가 주문',
    liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-06-10 00:00:00' WHERE id = ?").run(target.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '005930': 65_000 },
    holdings: [{
      pdno: '005930',
      hldg_qty: '10',
      pchs_avg_pric: '70000',
      prpr: '65000'
    }],
    openOrdersError: true
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-06-10T00:20:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /미체결 주문을 확인하지 못해 안전상 주문하지 않습니다/);
        assert.equal(result.order, null);
        assert.equal(state.orderCalls || 0, 0);
        assert.equal(state.cancelCalls || 0, 0);
      });
    });

    const sellOrders = repo.listOrders(user.id, { strategyId: strategy.id })
      .filter((order) => order.side === 'SELL');
    assert.equal(sellOrders.filter((order) => order.sellReason !== 'TARGET').length, 0);
    assert.equal(repo.getOrder(user.id, target.id).status, 'ACCEPTED');
    assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, '005930');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 미체결 목록의 현재 TARGET만 제외한 뒤 정상 방어 매도를 수행한다', async () => {
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
  repo.setHolding(user.id, strategy.id, {
    symbol: '005931',
    symbolName: '정상방어',
    entryWindow: 'MORNING'
  });
  createLiveFilledBuy(strategy, { symbol: '005931' });
  const target = repo.createOrder(user.id, {
    strategyId: strategy.id,
    symbol: '005931',
    symbolName: '정상방어',
    side: 'SELL',
    sellReason: 'TARGET',
    entryWindow: 'MORNING',
    quantity: 10,
    orderPrice: 71_400,
    estimatedAmount: 714_000,
    kisOrderNo: 'TARGET-SAFE-REPLACE',
    kisOriginalOrderNo: 'TARGET-SAFE-ORIGINAL',
    status: 'ACCEPTED',
    remainingQuantity: 10,
    idempotencyKey: `20260610-${strategy.id}-MORNING-SELL-TARGET`,
    decisionReason: '목표가 주문',
    liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-06-10 00:00:00' WHERE id = ?").run(target.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '005931': 65_000 },
    holdings: [{
      pdno: '005931', hldg_qty: '10', pchs_avg_pric: '70000', prpr: '65000'
    }],
    openOrders: [{
      pdno: '005931', odno: 'TARGET-SAFE-REPLACE', orgn_odno: 'TARGET-SAFE-ORIGINAL',
      ord_qty: '10', tot_ccld_qty: '0', nccs_qty: '10', sll_buy_dvsn_cd: '01'
    }],
    openOrdersAfterCancel: [],
    historyAfterCancel: [
      {
        odno: 'TARGET-SAFE-REPLACE', pdno: '005931', ord_qty: '10',
        tot_ccld_qty: '0', rmn_qty: '10', sll_buy_dvsn_cd: '01'
      },
      {
        odno: 'TARGET-SAFE-CANCEL', orgn_odno: 'TARGET-SAFE-REPLACE', pdno: '005931',
        ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '0', sll_buy_dvsn_cd: '01',
        cncl_yn: 'Y', cnc_cfrm_qty: '10'
      }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-06-10T00:20:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.decision.sellReason, 'STOP_LOSS');
        assert.equal(result.order.status, 'ACCEPTED');
        assert.equal(state.cancelCalls, 1);
        assert.equal(state.orderCalls, 1);
      });
    });

    assert.equal(repo.getOrder(user.id, target.id).status, 'CANCELED');
    const defensiveOrders = repo.listOrders(user.id, { strategyId: strategy.id })
      .filter((order) => order.side === 'SELL' && order.sellReason === 'STOP_LOSS');
    assert.equal(defensiveOrders.length, 1);
    assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, '005931');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: TARGET 외 다른 미체결 주문이 있으면 TARGET을 취소하지 않는다', async () => {
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
  repo.setHolding(user.id, strategy.id, {
    symbol: '005932',
    symbolName: '중복방어',
    entryWindow: 'MORNING'
  });
  createLiveFilledBuy(strategy, { symbol: '005932' });
  const target = repo.createOrder(user.id, {
    strategyId: strategy.id,
    symbol: '005932',
    symbolName: '중복방어',
    side: 'SELL',
    sellReason: 'TARGET',
    entryWindow: 'MORNING',
    quantity: 10,
    orderPrice: 71_400,
    estimatedAmount: 714_000,
    kisOrderNo: 'TARGET-WITH-OTHER',
    kisOriginalOrderNo: 'TARGET-WITH-OTHER-ORIGINAL',
    status: 'ACCEPTED',
    remainingQuantity: 10,
    idempotencyKey: `20260610-${strategy.id}-MORNING-SELL-TARGET`,
    decisionReason: '목표가 주문',
    liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-06-10 00:00:00' WHERE id = ?").run(target.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '005932': 65_000 },
    holdings: [{
      pdno: '005932', hldg_qty: '10', pchs_avg_pric: '70000', prpr: '65000'
    }],
    openOrders: [
      {
        pdno: '005932', odno: 'TARGET-WITH-OTHER', orgn_odno: 'TARGET-WITH-OTHER-ORIGINAL',
        ord_qty: '10', tot_ccld_qty: '0', nccs_qty: '10', sll_buy_dvsn_cd: '01'
      },
      {
        // 동일 조직번호는 주문 identity가 아니다. TARGET과 같아도 별도 주문으로 남아야 한다.
        pdno: '005932', odno: 'UNRELATED-OPEN-ORDER', orgn_odno: 'TARGET-WITH-OTHER-ORIGINAL',
        ord_qty: '1', tot_ccld_qty: '0', nccs_qty: '1', sll_buy_dvsn_cd: '01'
      }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-06-10T00:20:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /미체결 주문이 있어 신규 주문을 만들지 않습니다/);
        assert.equal(result.order, null);
        assert.equal(state.cancelCalls || 0, 0);
        assert.equal(state.orderCalls || 0, 0);
      });
    });

    assert.equal(repo.getOrder(user.id, target.id).status, 'ACCEPTED');
    const defensiveOrders = repo.listOrders(user.id, { strategyId: strategy.id })
      .filter((order) => order.side === 'SELL' && order.sellReason === 'STOP_LOSS');
    assert.equal(defensiveOrders.length, 0);
    assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, '005932');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 실패 주문 재시도에서 상승 추격이면 SKIPPED로 구간을 종결한다', async () => {
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
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-11',
    entryWindow: 'MORNING',
    status: 'SELECTED',
    selectedSymbol: '005930',
    selectedSymbolName: '삼성전자',
    selectedPrice: 70_000,
    selectedFluctuationRate: 0.10,
    bought: false
  });
  repo.createOrder(user.id, {
    strategyId: strategy.id,
    entryId: entry.id,
    symbol: '005930',
    symbolName: '삼성전자',
    side: 'BUY',
    entryWindow: 'MORNING',
    quantity: 10,
    orderPrice: 70_000,
    estimatedAmount: 700_000,
    status: 'FAILED',
    idempotencyKey: `20260611-${strategy.id}-MORNING-BUY`,
    decisionReason: '첫 주문 실패',
    liveOrderEnabled: true,
    errorMessage: '일시적 주문 실패'
  });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    cash: 1_000_000,
    prices: { '005930': 71_000 },
    minuteRows: passingMinuteCandles(70_000)
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-06-11T00:11:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /현재가가 새 신호가보다.*추격 매수를 중단/);
        assert.match(result.decision.reason, /이 구간을 종료/);
        assert.equal(result.order, null);
        assert.equal(state.orderCalls || 0, 0);
      });
    });
    const refreshedEntry = repo.getEntry(strategy.id, '2026-06-11', 'MORNING');
    assert.equal(refreshedEntry.status, 'SKIPPED');
    assert.equal(refreshedEntry.selectedSymbol, null, '무효 후보를 지우고 같은 구간의 늦은 대체 매수를 막아야 한다');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 실패 주문 재시도 시 최신 점심 등락률이 15%에 닿으면 후보를 해제한다', async () => {
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
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-12',
    entryWindow: 'LUNCH',
    status: 'SELECTED',
    selectedSymbol: '005930',
    selectedSymbolName: '삼성전자',
    selectedPrice: 70_000,
    selectedFluctuationRate: 0.149,
    bought: false
  });
  repo.createOrder(user.id, {
    strategyId: strategy.id,
    entryId: entry.id,
    symbol: '005930',
    symbolName: '삼성전자',
    side: 'BUY',
    entryWindow: 'LUNCH',
    quantity: 10,
    orderPrice: 70_000,
    estimatedAmount: 700_000,
    status: 'FAILED',
    idempotencyKey: `20260612-${strategy.id}-LUNCH-BUY`,
    decisionReason: '첫 주문 실패',
    liveOrderEnabled: true,
    errorMessage: '일시적 주문 실패'
  });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    minuteRows: passingMinuteCandles(70_000),
    rankingRows: [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '15.0' }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-06-12T02:31:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /최신 랭킹.*진입 범위.*15% 미만/);
        assert.equal(result.order, null);
        assert.equal(state.orderCalls || 0, 0);
      });
    });
    const refreshedEntry = repo.getEntry(strategy.id, '2026-06-12', 'LUNCH');
    assert.equal(refreshedEntry.status, 'SKIPPED');
    assert.equal(refreshedEntry.selectedSymbol, null);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 주문 전 재검증에서 오전 등락률 15% 미만과 20% 이상을 모두 제외한다', async () => {
  const scenarios = [
    { tradeDate: '2026-06-15', iso: '2026-06-15T00:11:00Z', rate: '14.9' },
    { tradeDate: '2026-06-16', iso: '2026-06-16T00:11:00Z', rate: '20.0' }
  ];

  for (const scenario of scenarios) {
    const strategy = createRunningStrategy();
    repo.createEntry(user.id, {
      strategyId: strategy.id,
      tradeDate: scenario.tradeDate,
      entryWindow: 'MORNING',
      status: 'SELECTED',
      selectedSymbol: '005930',
      selectedSymbolName: '삼성전자',
      selectedPrice: 70_000,
      selectedFluctuationRate: 0.16,
      bought: false
    });
    const state = {
      cash: 1_000_000,
      prices: { '005930': 70_000 },
      minuteRows: passingMinuteCandles(70_000),
      rankingRows: [
        { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: scenario.rate }
      ]
    };

    await withMockedFetch(state, async () => {
      await withMockedDate(scenario.iso, async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /진입 범위\(15% 이상 20% 미만\)를 벗어났습니다/);
        assert.equal(result.order, null);
        assert.equal(state.orderCalls || 0, 0);
      });
    });
    assert.equal(repo.getEntry(strategy.id, scenario.tradeDate, 'MORNING').status, 'SKIPPED');
  }
});

test('한국 랭킹: 확인 tick에 선택 종목이 원본 11위로 밀리면 SKIPPED로 종결한다', async () => {
  const strategy = createRunningStrategy();
  repo.createEntry(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-17',
    entryWindow: 'MORNING',
    status: 'SELECTED',
    selectedSymbol: '005930',
    selectedSymbolName: '삼성전자',
    selectedPrice: 70_000,
    selectedFluctuationRate: 0.10,
    bought: false
  });
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    rankingRows: [
      ...Array.from({ length: 10 }, (_, index) => ({
        stck_shrn_iscd: String(100000 + index),
        hts_kor_isnm: `원본상위${index + 1}`,
        stck_prpr: '10000',
        prdy_ctrt: '25.0'
      })),
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
    ]
  };
  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-17T00:11:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.match(result.decision.reason, /최신 랭킹에서 사라졌거나/);
      assert.match(result.decision.reason, /이 구간을 종료/);
      assert.equal(result.order, null);
      assert.equal(state.orderCalls || 0, 0);
    });
  });

  const entry = repo.getEntry(strategy.id, '2026-06-17', 'MORNING');
  assert.equal(entry.status, 'SKIPPED');
  assert.equal(entry.selectedSymbol, null);
});

test('한국 랭킹: 확인 tick 현재가가 최초 선택가보다 0.7% 넘게 하락하면 SKIPPED로 종결한다', async () => {
  const strategy = createRunningStrategy();
  repo.createEntry(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-15',
    entryWindow: 'MORNING',
    status: 'SELECTED',
    selectedSymbol: '005930',
    selectedSymbolName: '삼성전자',
    selectedPrice: 70_000,
    selectedFluctuationRate: 0.10,
    bought: false
  });
  const state = {
    cash: 1_000_000,
    prices: { '005930': 69_000 },
    minuteRows: passingMinuteCandles(69_000),
    rankingRows: [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '69000', prdy_ctrt: '16.0' }
    ]
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-15T00:11:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.match(result.decision.reason, /최초 선택가보다.*급락/);
      assert.equal(result.order, null);
      assert.equal(state.orderCalls || 0, 0);
    });
  });

  assert.equal(repo.getEntry(strategy.id, '2026-06-15', 'MORNING').status, 'SKIPPED');
});

test('한국 랭킹: 확인 tick 현재가가 새 분봉 신호가보다 0.7% 넘게 하락하면 SKIPPED로 종결한다', async () => {
  const strategy = createRunningStrategy();
  repo.createEntry(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-06-16',
    entryWindow: 'MORNING',
    status: 'SELECTED',
    selectedSymbol: '005930',
    selectedSymbolName: '삼성전자',
    selectedPrice: 69_000,
    selectedFluctuationRate: 0.10,
    bought: false
  });
  const state = {
    cash: 1_000_000,
    prices: { '005930': 69_000 },
    minuteRows: passingMinuteCandles(70_000),
    rankingRows: [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '69000', prdy_ctrt: '16.0' }
    ]
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-16T00:11:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.match(result.decision.reason, /새 신호가보다.*급락/);
      assert.equal(result.order, null);
      assert.equal(state.orderCalls || 0, 0);
    });
  });

  assert.equal(repo.getEntry(strategy.id, '2026-06-16', 'MORNING').status, 'SKIPPED');
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

test('한국 랭킹: 첫 평가 전원 거절이어도 5분 안에는 재관찰하고 안정 후보를 다음 tick 확인 후 매수한다', async () => {
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

  const state = {
    rankingRows: [
      { stck_shrn_iscd: '018260', hts_kor_isnm: '삼성에스디에스', stck_prpr: '286500', prdy_ctrt: '25.0' },
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '21.0' }
    ],
    cash: 1_000_000,
    prices: { '005930': 70_000 }
  };
  await withMockedFetch(state, async () => {
    await withMockedDate('2026-06-08T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.equal(result.decision.entryWindow, 'MORNING');
      assert.match(result.decision.reason, /진입 관찰 중/);
      assert.equal(result.order, null);
      assert.equal(state.rankingCalls, 1);
      assert.equal(state.orderCalls || 0, 0);
      const entry = repo.getEntry(strategy.id, '2026-06-08', 'MORNING');
      assert.equal(entry, null);
    });
    state.rankingRows = [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
    ];
    await withMockedDate('2026-06-08T00:10:30Z', async () => {
      const second = await service.evaluateStrategy(user.id, strategy.id);
      assert.match(second.decision.reason, /진입 관찰 중/);
      assert.equal(state.rankingCalls, 2);
      assert.equal(state.orderCalls || 0, 0);
    });
    await withMockedDate('2026-06-08T00:11:00Z', async () => {
      const selected = await service.evaluateStrategy(user.id, strategy.id);
      assert.match(selected.decision.reason, /후보를 선택했습니다/);
      assert.equal(state.rankingCalls, 3);
      assert.equal(state.orderCalls || 0, 0);
    });
    await withMockedDate('2026-06-08T00:11:30Z', async () => {
      const bought = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(bought.decision.decision, 'BUY');
      assert.equal(bought.order.status, 'ACCEPTED');
      assert.equal(state.orderCalls, 1);
    });
  });

  const entry = repo.getEntry(strategy.id, '2026-06-08', 'MORNING');
  assert.equal(entry.status, 'SELECTED');
  assert.equal(entry.selectedSymbol, '005930');

  autoTradingRepo.updateLiveOrderSetting(user.id, false);
});

test('한국 랭킹: 검증 전 live 재탐색은 첫 판단에서 종결하되 이후 5분 랭킹은 shadow로 저장한다', async () => {
  const strategy = createRunningStrategy();
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    rankingRows: [
      { stck_shrn_iscd: '018260', hts_kor_isnm: '삼성에스디에스', stck_prpr: '286500', prdy_ctrt: '25.0' }
    ],
    cash: 1_000_000,
    prices: { '005930': 70_000 }
  };

  try {
    await withEnvOverride({ krRankLiveEntryRetryEnabled: false }, async () => {
      await withMockedFetch(state, async () => {
        await withMockedDate('2026-06-09T00:10:00Z', async () => {
          const first = await service.evaluateStrategy(user.id, strategy.id);
          assert.equal(first.order, null);
          assert.match(first.decision.reason, /검증 전.*실주문 재탐색/);
        });
        const entry = repo.getEntry(strategy.id, '2026-06-09', 'MORNING');
        assert.equal(entry.status, 'NO_CANDIDATE');

        state.rankingRows = [
          { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
        ];
        await withMockedDate('2026-06-09T00:10:30Z', async () => {
          const shadow = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
          assert.equal(shadow.order, null);
          assert.equal(state.orderCalls || 0, 0);
        });
      });
    });

    const observations = repo.listObservations(strategy.id, '2026-06-09', 'MORNING', { limit: 30 });
    assert.equal(observations.length, 2);
    assert.equal(observations.at(-1).rankingSnapshot[0].symbol, '005930');
    assert.equal(repo.getEntry(strategy.id, '2026-06-09', 'MORNING').status, 'NO_CANDIDATE');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 오전 실주문 손실 후에도 수익 기회인 점심 진입 평가를 계속한다', async () => {
  const strategy = createRunningStrategy({
    lunchEntryEnabled: true,
    lunchBudget: 1_000_000
  });
  db.prepare("UPDATE kr_rank_strategies SET started_at = '2026-07-01 00:00:00' WHERE id = ?").run(strategy.id);
  createLiveFilledExit(strategy, {
    symbol: 'LOSS-TODAY',
    sellReason: 'ENTRY_FAILED',
    realizedProfitAmount: -5_000,
    realizedProfitRate: -0.05,
    filledAt: '2026-07-16 00:05:00'
  });
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    rankingRows: [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '10.0' }
    ]
  };
  seedStableObservations(strategy, '2026-07-16', 'LUNCH', [
    { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.10 }
  ]);

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-16T02:30:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.equal(result.decision.entryWindow, 'LUNCH');
      assert.match(result.decision.reason, /후보를 선택했습니다/);
      assert.doesNotMatch(result.decision.reason, /손실 회로 차단기/);
      assert.equal(result.order, null);
      assert.equal(state.rankingCalls, 1);
      assert.equal(state.orderCalls || 0, 0);
    });
  });

  const lunch = repo.getEntry(strategy.id, '2026-07-16', 'LUNCH');
  assert.equal(lunch.status, 'SELECTED');
  assert.equal(repo.getStrategy(user.id, strategy.id).status, 'RUNNING');
});

test('한국 랭킹: 이전 거래일 2연속 손실 후에도 다음 거래일에 자동 재개한다', async () => {
  const strategy = createRunningStrategy();
  db.prepare("UPDATE kr_rank_strategies SET started_at = '2026-07-01 00:00:00' WHERE id = ?").run(strategy.id);
  createLiveFilledExit(strategy, {
    symbol: 'LOSS-ONE',
    sellReason: 'ENTRY_FAILED',
    realizedProfitAmount: -4_000,
    realizedProfitRate: -0.04,
    filledAt: '2026-07-14 00:20:00'
  });
  createLiveFilledExit(strategy, {
    symbol: 'LOSS-TWO',
    sellReason: 'STOP_LOSS',
    realizedProfitAmount: -5_000,
    realizedProfitRate: -0.05,
    filledAt: '2026-07-15 00:20:00'
  });
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    rankingRows: [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
    ]
  };
  seedStableObservations(strategy, '2026-07-16', 'MORNING', [
    { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.16 }
  ]);

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-16T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.match(result.decision.reason, /후보를 선택했습니다/);
      assert.doesNotMatch(result.decision.reason, /손실 회로 차단기/);
      assert.equal(result.order, null);
      assert.equal(state.rankingCalls, 1);
      assert.equal(state.orderCalls || 0, 0);
    });
  });

  const resumed = repo.getStrategy(user.id, strategy.id);
  assert.equal(resumed.status, 'RUNNING');
  assert.equal(resumed.holdingSymbol, null);
  assert.equal(repo.getEntry(strategy.id, '2026-07-16', 'MORNING').status, 'SELECTED');
});

test('한국 랭킹: STOP_LOSS 주문이 ACCEPTED일 뿐이면 확정 손실 연속 횟수에 넣지 않는다', () => {
  const strategy = createRunningStrategy();
  db.prepare("UPDATE kr_rank_strategies SET started_at = '2026-07-01 00:00:00' WHERE id = ?").run(strategy.id);
  createLiveFilledExit(strategy, {
    symbol: 'CONFIRMED-LOSS',
    sellReason: 'ENTRY_FAILED',
    realizedProfitAmount: -4_000,
    realizedProfitRate: -0.04,
    filledAt: '2026-07-14 00:20:00'
  });
  repo.createOrder(user.id, {
    strategyId: strategy.id,
    symbol: 'ACCEPTED-NOT-FILLED',
    symbolName: '접수만됨',
    side: 'SELL',
    sellReason: 'STOP_LOSS',
    entryWindow: 'MORNING',
    quantity: 1,
    orderPrice: 900,
    estimatedAmount: 900,
    kisOrderNo: 'ACCEPTED-STOP-1',
    status: 'ACCEPTED',
    idempotencyKey: `${strategy.id}-ACCEPTED-STOP`,
    decisionReason: '접수는 체결이 아님',
    liveOrderEnabled: true
  });

  const risk = repo.getLiveLossRiskState(strategy.id, {
    tradeDate: '2026-07-15',
    since: '2026-07-01 00:00:00'
  });
  assert.equal(risk.consecutiveLossExits, 1);
  assert.equal(risk.lossExitToday, false);
});

test('한국 랭킹: 당일 손실 2회 뒤에도 이미 접수된 BUY는 일일 잠금보다 먼저 체결 동기화를 계속한다', async () => {
  const strategy = createRunningStrategy();
  db.prepare("UPDATE kr_rank_strategies SET started_at = '2026-07-01 00:00:00' WHERE id = ?").run(strategy.id);
  createLiveFilledExit(strategy, {
    symbol: 'OPEN-LOSS-ONE',
    sellReason: 'ENTRY_FAILED',
    realizedProfitAmount: -4_000,
    realizedProfitRate: -0.04,
    filledAt: '2026-07-16 00:04:00'
  });
  createLiveFilledExit(strategy, {
    symbol: 'OPEN-LOSS-TWO',
    sellReason: 'STOP_LOSS',
    realizedProfitAmount: -5_000,
    realizedProfitRate: -0.05,
    filledAt: '2026-07-16 00:05:00'
  });
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-07-16',
    entryWindow: 'MORNING',
    status: 'SELECTED',
    selectedSymbol: 'PENDING',
    selectedSymbolName: '미체결',
    selectedPrice: 1_000,
    selectedFluctuationRate: 0.10,
    bought: false
  });
  const open = repo.createOrder(user.id, {
    strategyId: strategy.id,
    entryId: entry.id,
    symbol: 'PENDING',
    symbolName: '미체결',
    side: 'BUY',
    entryWindow: 'MORNING',
    quantity: 1,
    orderPrice: 1_000,
    estimatedAmount: 1_000,
    kisOrderNo: 'PENDING-BUY-1',
    status: 'ACCEPTED',
    idempotencyKey: `20260716-${strategy.id}-MORNING-BUY`,
    decisionReason: '미체결 정리 테스트',
    liveOrderEnabled: true
  });
  const state = {
    cash: 1_000_000,
    prices: { PENDING: 1_000 },
    holdings: [{ pdno: 'PENDING', hldg_qty: '1', pchs_avg_pric: '1000', prpr: '1000' }],
    openOrders: [],
    history: [{
      odno: 'PENDING-BUY-1', pdno: 'PENDING', sll_buy_dvsn_cd: '02',
      ord_qty: '1', tot_ccld_qty: '1', rmn_qty: '0', avg_prvs: '1000'
    }]
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-16T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.match(result.decision.reason, /보유로 전환/);
      assert.equal(state.orderCalls, 1); // 신규 BUY가 아니라 체결분 보호 TARGET
    });
  });

  assert.equal(repo.getOrder(user.id, open.id).status, 'FILLED');
  assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, 'PENDING');
  assert.equal(repo.getStrategy(user.id, strategy.id).status, 'RUNNING');
});

test('한국 랭킹: 최근 TARGET 승리는 이전 손실 연속 횟수를 초기화한다', async () => {
  const strategy = createRunningStrategy();
  db.prepare("UPDATE kr_rank_strategies SET started_at = '2026-07-01 00:00:00' WHERE id = ?").run(strategy.id);
  createLiveFilledExit(strategy, {
    symbol: 'RESET-LOSS-ONE',
    sellReason: 'ENTRY_FAILED',
    realizedProfitAmount: -4_000,
    realizedProfitRate: -0.04,
    filledAt: '2026-07-13 00:20:00'
  });
  createLiveFilledExit(strategy, {
    symbol: 'RESET-LOSS-TWO',
    sellReason: 'STOP_LOSS',
    realizedProfitAmount: -5_000,
    realizedProfitRate: -0.05,
    filledAt: '2026-07-14 00:20:00'
  });
  createLiveFilledExit(strategy, {
    symbol: 'RESET-TARGET',
    sellReason: 'TARGET',
    realizedProfitAmount: 2_000,
    realizedProfitRate: 0.02,
    filledAt: '2026-07-15 00:20:00'
  });
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    rankingRows: [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
    ]
  };
  seedStableObservations(strategy, '2026-07-16', 'MORNING', [
    { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.16 }
  ]);

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-16T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.match(result.decision.reason, /후보를 선택했습니다/);
      assert.equal(repo.getStrategy(user.id, strategy.id).status, 'RUNNING');
      assert.equal(state.orderCalls || 0, 0);
    });
  });
});

test('한국 랭킹: 당일 위험 청산 2회면 남은 진입만 잠그고 다음 거래일에 자동 재개한다', async () => {
  const strategy = createRunningStrategy();
  db.prepare("UPDATE kr_rank_strategies SET started_at = '2026-07-01 00:00:00' WHERE id = ?").run(strategy.id);
  createLiveFilledExit(strategy, {
    symbol: 'DAILY-LOSS-ONE',
    sellReason: 'ENTRY_FAILED',
    realizedProfitAmount: -4_000,
    realizedProfitRate: -0.04,
    filledAt: '2026-07-16 00:04:00'
  });
  createLiveFilledExit(strategy, {
    symbol: 'DAILY-LOSS-TWO',
    sellReason: 'STOP_LOSS',
    realizedProfitAmount: -5_000,
    realizedProfitRate: -0.05,
    filledAt: '2026-07-16 00:05:00'
  });
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    rankingRows: [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
    ]
  };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-16T00:10:00Z', async () => {
      const locked = await service.evaluateStrategy(user.id, strategy.id);
      assert.match(locked.decision.reason, /일일 손실 회로 차단기/);
      assert.match(locked.decision.reason, /다음 거래일에 자동 재개/);
      assert.equal(repo.getStrategy(user.id, strategy.id).status, 'RUNNING');
      assert.equal(state.rankingCalls || 0, 0);
    });
  });

  seedStableObservations(strategy, '2026-07-17', 'MORNING', [
    { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.16 }
  ]);

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-17T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'SKIP');
      assert.match(result.decision.reason, /후보를 선택했습니다/);
      assert.doesNotMatch(result.decision.reason, /손실 회로 차단기/);
      assert.equal(repo.getStrategy(user.id, strategy.id).status, 'RUNNING');
    });
  });
});

test('한국 랭킹: 진입창 종료 뒤에도 접수된 BUY 체결을 확인해 holding과 TARGET을 만든다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING',
    status: 'SELECTED', selectedSymbol: '091810', selectedSymbolName: '티웨이항공',
    selectedPrice: 2_000, selectedFluctuationRate: 0.10, bought: false
  });
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '091810', symbolName: '티웨이항공',
    side: 'BUY', entryWindow: 'MORNING', quantity: 10, orderPrice: 2_000, estimatedAmount: 20_000,
    kisOrderNo: 'LATE-FILL-BUY-1', status: 'ACCEPTED',
    idempotencyKey: `20260720-${strategy.id}-MORNING-BUY`,
    decisionReason: '진입창 종료 체결 확인', liveOrderEnabled: true
  });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '091810': 2_010 },
    holdings: [{ pdno: '091810', hldg_qty: '10', pchs_avg_pric: '2002', prpr: '2010' }],
    openOrders: [],
    history: [{
      odno: 'LATE-FILL-BUY-1', pdno: '091810', sll_buy_dvsn_cd: '02',
      ord_qty: '10', tot_ccld_qty: '10', rmn_qty: '0', avg_prvs: '2002'
    }]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-20T01:01:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /보유로 전환/);
      });
    });

    assert.equal(repo.getOrder(user.id, buy.id).status, 'FILLED');
    assert.equal(repo.getEntry(strategy.id, '2026-07-20', 'MORNING').status, 'BOUGHT');
    assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, '091810');
    const target = repo.listOrders(user.id, { strategyId: strategy.id })
      .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
    assert.ok(target);
    assert.equal(target.status, 'ACCEPTED');
    assert.equal(target.quantity, 10);
    assert.equal(state.orderCalls, 1);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 진입 시작 5분 뒤 최초 평가는 랭킹 조회 없이 NO_CANDIDATE로 종결한다', async () => {
  const strategy = createRunningStrategy();
  const state = { cash: 1_000_000 };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-20T00:15:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.match(result.decision.reason, /시작 후 5분 동안/);
    });
  });

  assert.equal(repo.getEntry(strategy.id, '2026-07-20', 'MORNING').status, 'NO_CANDIDATE');
  assert.equal(state.rankingCalls || 0, 0);
  assert.equal(state.orderCalls || 0, 0);
});

test('한국 랭킹: 주문 없는 SELECTED 후보는 선택 후 3분 뒤 새 주문 없이 SKIPPED로 종결한다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING',
    status: 'SELECTED', selectedSymbol: '005930', selectedSymbolName: '삼성전자',
    selectedPrice: 70_000, selectedFluctuationRate: 0.10, bought: false
  });
  db.prepare("UPDATE kr_rank_entries SET created_at = '2026-07-20 00:10:00', updated_at = '2026-07-20 00:10:00' WHERE id = ?")
    .run(entry.id);
  const state = { cash: 1_000_000 };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-20T00:13:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.match(result.decision.reason, /선택 후 3분 안에/);
    });
  });

  assert.equal(repo.getEntryById(entry.id).status, 'SKIPPED');
  assert.equal(state.rankingCalls || 0, 0);
  assert.equal(state.orderCalls || 0, 0);
});

test('한국 랭킹: 주문 없는 SELECTED는 당일 위험 2회 진입 잠금에서 SKIPPED로 종결한다', async () => {
  const strategy = createRunningStrategy();
  db.prepare("UPDATE kr_rank_strategies SET started_at = '2026-07-01 00:00:00' WHERE id = ?").run(strategy.id);
  createLiveFilledExit(strategy, {
    symbol: 'LOCK-ONE', sellReason: 'ENTRY_FAILED', realizedProfitAmount: -1_000,
    realizedProfitRate: -0.01, filledAt: '2026-07-20 00:04:00'
  });
  createLiveFilledExit(strategy, {
    symbol: 'LOCK-TWO', sellReason: 'STOP_LOSS', realizedProfitAmount: -2_000,
    realizedProfitRate: -0.02, filledAt: '2026-07-20 00:05:00'
  });
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING',
    status: 'SELECTED', selectedSymbol: '005930', selectedSymbolName: '삼성전자',
    selectedPrice: 70_000, selectedFluctuationRate: 0.10, bought: false
  });
  const state = { cash: 1_000_000 };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-20T00:10:30Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.match(result.decision.reason, /일일 손실 회로 차단기/);
    });
  });

  assert.equal(repo.getEntryById(entry.id).status, 'SKIPPED');
  assert.equal(repo.getEntryById(entry.id).selectedSymbol, null);
  assert.equal(repo.getStrategy(user.id, strategy.id).status, 'RUNNING');
  assert.equal(state.rankingCalls || 0, 0);
  assert.equal(state.orderCalls || 0, 0);
});

test('한국 랭킹: global OFF에서는 기존 live 포지션의 손절·TARGET 취소·DRY_RUN 변환을 모두 막는다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING', status: 'BOUGHT',
    selectedSymbol: '005930', selectedSymbolName: '삼성전자', selectedPrice: 70_000,
    selectedFluctuationRate: 0.10, bought: true
  });
  repo.setHolding(user.id, strategy.id, { symbol: '005930', symbolName: '삼성전자', entryWindow: 'MORNING' });
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '005930', symbolName: '삼성전자',
    side: 'BUY', entryWindow: 'MORNING', quantity: 10, orderPrice: 70_000, estimatedAmount: 700_000,
    kisOrderNo: 'GLOBAL-OFF-BUY', status: 'FILLED', filledQuantity: 10, remainingQuantity: 0,
    averageFilledPrice: 70_000, idempotencyKey: `20260720-${strategy.id}-MORNING-BUY`,
    decisionReason: 'live provenance', liveOrderEnabled: true
  });
  const target = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '005930', symbolName: '삼성전자',
    side: 'SELL', sellReason: 'TARGET', entryWindow: 'MORNING', quantity: 10,
    orderPrice: 71_400, estimatedAmount: 714_000, kisOrderNo: 'GLOBAL-OFF-TARGET',
    status: 'ACCEPTED', remainingQuantity: 10,
    idempotencyKey: `20260720-${strategy.id}-MORNING-SELL-TARGET`,
    decisionReason: 'live target', liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-20 00:00:00' WHERE id IN (?, ?)").run(buy.id, target.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '005930': 65_000 },
    holdings: [{ pdno: '005930', hldg_qty: '10', pchs_avg_pric: '70000', prpr: '65000' }],
    openOrders: [{
      pdno: '005930', odno: 'GLOBAL-OFF-TARGET', ord_qty: '10', tot_ccld_qty: '0',
      nccs_qty: '10', sll_buy_dvsn_cd: '01'
    }]
  };

  try {
    await withEnvOverride({ enableLiveOrder: 'false' }, async () => {
      await withMockedFetch(state, async () => {
        await withMockedDate('2026-07-20T00:20:00Z', async () => {
          const result = await service.evaluateStrategy(user.id, strategy.id);
          assert.equal(result.decision.decision, 'SKIP');
          assert.match(result.decision.reason, /전역 실주문 중지 상태/);
        });
      });
    });

    assert.equal(state.cancelCalls || 0, 0);
    assert.equal(state.orderCalls || 0, 0);
    assert.equal(repo.getOrder(user.id, target.id).status, 'ACCEPTED');
    assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, '005930');
    assert.equal(repo.listOrders(user.id, { strategyId: strategy.id }).some((order) => order.status === 'DRY_RUN'), false);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: global OFF에서도 BUY 체결 상태는 동기화하되 TARGET 주문은 만들지 않는다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING', status: 'SELECTED',
    selectedSymbol: '000660', selectedSymbolName: 'SK하이닉스', selectedPrice: 200_000,
    selectedFluctuationRate: 0.10, bought: false
  });
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '000660', symbolName: 'SK하이닉스',
    side: 'BUY', entryWindow: 'MORNING', quantity: 2, orderPrice: 200_000, estimatedAmount: 400_000,
    kisOrderNo: 'GLOBAL-OFF-SYNC-BUY', status: 'ACCEPTED',
    idempotencyKey: `20260720-${strategy.id}-MORNING-BUY`,
    decisionReason: 'global off sync', liveOrderEnabled: true
  });
  const state = { history: [{
    odno: 'GLOBAL-OFF-SYNC-BUY', pdno: '000660', sll_buy_dvsn_cd: '02',
    ord_qty: '2', tot_ccld_qty: '2', rmn_qty: '0', avg_prvs: '199500'
  }] };

  await withEnvOverride({ enableLiveOrder: 'false' }, async () => {
    await withMockedFetch(state, async () => {
      const updated = await service.syncOrderFills(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 1);
    });
  });

  assert.equal(repo.getOrder(user.id, buy.id).status, 'FILLED');
  assert.equal(repo.listOrders(user.id, { strategyId: strategy.id }).filter((order) => order.side === 'SELL').length, 0);
  assert.equal(state.orderCalls || 0, 0);
});

test('한국 랭킹: BUY 일부체결 후 잔량 취소를 병합하고 체결분 수량만 TARGET으로 보호한다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING', status: 'SELECTED',
    selectedSymbol: '105560', selectedSymbolName: 'KB금융', selectedPrice: 90_000,
    selectedFluctuationRate: 0.10, bought: false
  });
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '105560', symbolName: 'KB금융',
    side: 'BUY', entryWindow: 'MORNING', quantity: 10, orderPrice: 90_000, estimatedAmount: 900_000,
    kisOrderNo: 'PARTIAL-CANCEL-BUY', status: 'ACCEPTED',
    idempotencyKey: `20260720-${strategy.id}-MORNING-BUY`,
    decisionReason: 'partial cancel buy', liveOrderEnabled: true
  });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    holdings: [{ pdno: '105560', hldg_qty: '4', pchs_avg_pric: '89900', prpr: '90000' }],
    openOrders: [],
    history: [
      {
        odno: 'PARTIAL-CANCEL-BUY', pdno: '105560', sll_buy_dvsn_cd: '02',
        ord_qty: '10', tot_ccld_qty: '4', rmn_qty: '6', avg_prvs: '89900'
      },
      {
        odno: 'PARTIAL-CANCEL-ROW', orgn_odno: 'PARTIAL-CANCEL-BUY', pdno: '105560',
        sll_buy_dvsn_cd: '02', ord_qty: '6', tot_ccld_qty: '0', rmn_qty: '0',
        cncl_yn: 'Y', cnc_cfrm_qty: '6'
      }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      const updated = await service.syncOrderFills(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 1);
    });

    const after = repo.getOrder(user.id, buy.id);
    assert.equal(after.status, 'CANCELED');
    assert.equal(after.filledQuantity, 4);
    assert.equal(after.averageFilledPrice, 89_900);
    const target = repo.listOrders(user.id, { strategyId: strategy.id })
      .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
    assert.ok(target);
    assert.equal(target.quantity, 4);
    assert.equal(state.orderBodies[0].ORD_QTY, '4');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 살아 있는 BUY 일부체결 잔량을 취소 확인한 뒤 실제 잔고만 보유·TARGET으로 전환한다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING', status: 'SELECTED',
    selectedSymbol: '086790', selectedSymbolName: '하나금융지주', selectedPrice: 80_000,
    selectedFluctuationRate: 0.10, bought: false
  });
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '086790', symbolName: '하나금융지주',
    side: 'BUY', entryWindow: 'MORNING', quantity: 10, orderPrice: 80_000, estimatedAmount: 800_000,
    kisOrderNo: 'OPEN-PARTIAL-BUY', status: 'PARTIALLY_FILLED', filledQuantity: 4,
    remainingQuantity: 6, averageFilledPrice: 79_900,
    idempotencyKey: `20260720-${strategy.id}-MORNING-BUY`,
    decisionReason: 'open partial buy', liveOrderEnabled: true
  });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const directPartial = {
    odno: 'OPEN-PARTIAL-BUY', pdno: '086790', sll_buy_dvsn_cd: '02',
    ord_qty: '10', tot_ccld_qty: '4', rmn_qty: '6', avg_prvs: '79900'
  };
  const state = {
    prices: { '086790': 80_000 },
    holdings: [{ pdno: '086790', hldg_qty: '4', pchs_avg_pric: '79900', prpr: '80000' }],
    openOrders: [directPartial],
    openOrdersAfterCancel: [],
    history: [directPartial],
    historyAfterCancel: [
      directPartial,
      {
        odno: 'OPEN-PARTIAL-CANCEL', orgn_odno: 'OPEN-PARTIAL-BUY', pdno: '086790',
        sll_buy_dvsn_cd: '02', ord_qty: '6', tot_ccld_qty: '0', rmn_qty: '0',
        cncl_yn: 'Y', cnc_cfrm_qty: '6'
      }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-20T00:10:30Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(result.decision.reason, /남은 매수 주문의 취소와 잔고 재확인/);
      });
    });

    const after = repo.getOrder(user.id, buy.id);
    assert.equal(after.status, 'CANCELED');
    assert.equal(after.filledQuantity, 4);
    assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, '086790');
    const target = repo.listOrders(user.id, { strategyId: strategy.id })
      .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
    assert.ok(target);
    assert.equal(target.quantity, 4);
    assert.equal(state.cancelCalls, 1);
    assert.equal(state.orderCalls, 1);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: TARGET 취소 요청이 거부되거나 원주문이 계속 active면 새 방어 SELL을 만들지 않는다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING', status: 'BOUGHT',
    selectedSymbol: '055550', selectedSymbolName: '신한지주', selectedPrice: 60_000,
    selectedFluctuationRate: 0.10, bought: true
  });
  repo.setHolding(user.id, strategy.id, { symbol: '055550', symbolName: '신한지주', entryWindow: 'MORNING' });
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '055550', symbolName: '신한지주', side: 'BUY',
    entryWindow: 'MORNING', quantity: 10, orderPrice: 60_000, estimatedAmount: 600_000,
    kisOrderNo: 'CANCEL-REJECT-BUY', status: 'FILLED', filledQuantity: 10, remainingQuantity: 0,
    averageFilledPrice: 60_000, idempotencyKey: `20260720-${strategy.id}-MORNING-BUY`,
    decisionReason: 'live buy', liveOrderEnabled: true
  });
  const target = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '055550', symbolName: '신한지주', side: 'SELL',
    sellReason: 'TARGET', entryWindow: 'MORNING', quantity: 10, orderPrice: 61_200,
    estimatedAmount: 612_000, kisOrderNo: 'CANCEL-REJECT-TARGET', status: 'ACCEPTED', remainingQuantity: 10,
    idempotencyKey: `20260720-${strategy.id}-MORNING-SELL-TARGET`,
    decisionReason: 'live target', liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-20 00:00:00' WHERE id IN (?, ?)").run(buy.id, target.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const activeRow = {
    odno: 'CANCEL-REJECT-TARGET', pdno: '055550', sll_buy_dvsn_cd: '01',
    ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '10'
  };
  const state = {
    prices: { '055550': 56_000 },
    holdings: [{ pdno: '055550', hldg_qty: '10', pchs_avg_pric: '60000', prpr: '56000' }],
    openOrders: [activeRow],
    openOrdersAfterCancel: [activeRow],
    historyAfterCancel: [
      activeRow,
      {
        odno: 'CANCEL-REJECT-ROW', orgn_odno: 'CANCEL-REJECT-TARGET', pdno: '055550',
        sll_buy_dvsn_cd: '01', ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '0', rjct_qty: '10'
      }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-20T00:20:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SKIP');
        assert.match(result.decision.reason, /취소가 확인되지 않아/);
      });
    });
    assert.equal(state.cancelCalls, 1);
    assert.equal(state.orderCalls || 0, 0);
    assert.equal(repo.getOrder(user.id, target.id).status, 'ACCEPTED');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 잔고 0이어도 live 매도 체결이 미확정이면 holding을 유지한다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING', status: 'BOUGHT',
    selectedSymbol: '035420', selectedSymbolName: 'NAVER', selectedPrice: 200_000,
    selectedFluctuationRate: 0.10, bought: true
  });
  repo.setHolding(user.id, strategy.id, { symbol: '035420', symbolName: 'NAVER', entryWindow: 'MORNING' });
  repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '035420', symbolName: 'NAVER', side: 'BUY',
    entryWindow: 'MORNING', quantity: 1, orderPrice: 200_000, estimatedAmount: 200_000,
    kisOrderNo: 'ZERO-BAL-BUY', status: 'FILLED', filledQuantity: 1, remainingQuantity: 0,
    averageFilledPrice: 200_000, idempotencyKey: `20260720-${strategy.id}-MORNING-BUY`,
    decisionReason: 'live buy', liveOrderEnabled: true
  });
  const target = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '035420', symbolName: 'NAVER', side: 'SELL',
    sellReason: 'TARGET', entryWindow: 'MORNING', quantity: 1, orderPrice: 204_000, estimatedAmount: 204_000,
    kisOrderNo: 'ZERO-BAL-TARGET', status: 'ACCEPTED', remainingQuantity: 1,
    idempotencyKey: `20260720-${strategy.id}-MORNING-SELL-TARGET`,
    decisionReason: 'live target', liveOrderEnabled: true
  });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '035420': 204_000 }, holdings: [], history: [],
    openOrders: [{
      pdno: '035420', odno: 'ZERO-BAL-TARGET', ord_qty: '1', tot_ccld_qty: '0',
      nccs_qty: '1', sll_buy_dvsn_cd: '01'
    }]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-20T00:20:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(result.decision.reason, /체결이 확정되지 않아 보유 상태 해제를 보류/);
      });
    });
    assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, '035420');
    assert.equal(repo.getOrder(user.id, target.id).status, 'ACCEPTED');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 일부체결 후 취소된 SELL은 남은 실제 잔고만 다시 매도한다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-20', entryWindow: 'MORNING', status: 'BOUGHT',
    selectedSymbol: '068270', selectedSymbolName: '셀트리온', selectedPrice: 180_000,
    selectedFluctuationRate: 0.10, bought: true
  });
  repo.setHolding(user.id, strategy.id, { symbol: '068270', symbolName: '셀트리온', entryWindow: 'MORNING' });
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '068270', symbolName: '셀트리온', side: 'BUY',
    entryWindow: 'MORNING', quantity: 10, orderPrice: 180_000, estimatedAmount: 1_800_000,
    kisOrderNo: 'PARTIAL-SELL-BUY', status: 'FILLED', filledQuantity: 10, remainingQuantity: 0,
    averageFilledPrice: 180_000, idempotencyKey: `20260720-${strategy.id}-MORNING-BUY`,
    decisionReason: 'live buy', liveOrderEnabled: true
  });
  const sellKey = `20260720-${strategy.id}-MORNING-SELL`;
  repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '068270', symbolName: '셀트리온', side: 'SELL',
    sellReason: 'STOP_LOSS', entryWindow: 'MORNING', quantity: 10, orderPrice: 170_000,
    estimatedAmount: 1_700_000, kisOrderNo: 'PARTIAL-SELL-OLD', status: 'CANCELED',
    filledQuantity: 4, remainingQuantity: 0, averageFilledPrice: 170_000,
    idempotencyKey: sellKey, decisionReason: 'partial canceled', liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-20 00:00:00' WHERE id = ?").run(buy.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '068270': 170_000 },
    holdings: [{ pdno: '068270', hldg_qty: '6', pchs_avg_pric: '180000', prpr: '170000' }],
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-20T00:20:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.order.quantity, 6);
      });
    });
    assert.equal(state.orderCalls, 1);
    assert.equal(state.orderBodies[0].ORD_QTY, '6');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 주문 응답 timeout은 UNKNOWN intent를 남겨 같은 BUY 자동 재전송을 막는다', async () => {
  const strategy = createRunningStrategy();
  seedStableObservations(strategy, '2026-07-21', 'MORNING', [
    { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.16 }
  ]);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    openOrders: [],
    orderNetworkError: true
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-21T00:10:00Z', async () => {
        const selected = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(selected.decision.reason, /후보를 선택했습니다/);
      });
      const selectedEntry = repo.getEntry(strategy.id, '2026-07-21', 'MORNING');
      db.prepare("UPDATE kr_rank_entries SET created_at = '2026-07-21 00:10:00' WHERE id = ?")
        .run(selectedEntry.id);
      await withMockedDate('2026-07-21T00:10:30Z', async () => {
        const attempted = await service.evaluateStrategy(user.id, strategy.id);
        assert.ok(attempted.order, JSON.stringify(attempted));
        assert.equal(attempted.order.status, 'UNKNOWN');
        assert.match(attempted.decision.reason, /자동 재전송을 막았습니다/);
      });
      await withMockedDate('2026-07-21T00:11:00Z', async () => {
        const next = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(next.decision.decision, 'SKIP');
        assert.match(next.decision.reason, /아직 체결되지 않아 보유 전환을 보류/);
      });
    });

    assert.equal(state.orderCalls, 1);
    const buys = repo.listOrders(user.id, { strategyId: strategy.id }).filter((order) => order.side === 'BUY');
    assert.equal(buys.length, 1);
    assert.equal(buys[0].status, 'UNKNOWN');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: KIS가 미접수를 명시한 업무 거절은 최신 신호 재검증 후 재시도한다', async () => {
  const strategy = createRunningStrategy();
  seedStableObservations(strategy, '2026-07-23', 'MORNING', [
    { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.16 }
  ]);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    openOrders: [],
    orderBusinessReject: true,
    orderRejectCode: 'APBK0919'
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-23T00:10:00Z', async () => {
        const selected = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(selected.decision.reason, /후보를 선택했습니다/);
      });
      const selectedEntry = repo.getEntry(strategy.id, '2026-07-23', 'MORNING');
      db.prepare("UPDATE kr_rank_entries SET created_at = '2026-07-23 00:10:00', updated_at = '2026-07-23 00:10:00' WHERE id = ?")
        .run(selectedEntry.id);
      await withMockedDate('2026-07-23T00:10:30Z', async () => {
        const rejected = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(rejected.order.status, 'REJECTED');
        assert.match(rejected.decision.reason, /다음 평가에서 안전 조건을 다시 확인/);
      });

      state.orderBusinessReject = false;
      await withMockedDate('2026-07-23T00:11:00Z', async () => {
        const retried = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(retried.order.status, 'ACCEPTED');
      });
    });

    const buys = repo.listOrders(user.id, { strategyId: strategy.id })
      .filter((order) => order.side === 'BUY');
    assert.equal(buys.length, 2);
    assert.deepEqual(buys.map((order) => order.status).sort(), ['ACCEPTED', 'REJECTED']);
    assert.equal(state.orderCalls, 2);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 90초간 전량 미체결된 BUY는 취소 확인 후 최신 신호로 재호가한다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-24', entryWindow: 'MORNING',
    status: 'SELECTED', selectedSymbol: '005930', selectedSymbolName: '삼성전자',
    selectedPrice: 70_000, selectedFluctuationRate: 0.16, bought: false
  });
  const stale = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '005930', symbolName: '삼성전자',
    side: 'BUY', entryWindow: 'MORNING', quantity: 10, orderPrice: 70_280,
    estimatedAmount: 702_800, kisOrderNo: 'STALE-KR-BUY', status: 'ACCEPTED',
    filledQuantity: 0, remainingQuantity: 10,
    idempotencyKey: `20260724-${strategy.id}-MORNING-BUY`,
    decisionReason: '오래된 미체결 매수', liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_entries SET created_at = '2026-07-24 00:10:00', updated_at = '2026-07-24 00:10:00' WHERE id = ?")
    .run(entry.id);
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-24 00:10:00', updated_at = '2026-07-24 00:10:00' WHERE id = ?")
    .run(stale.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const active = {
    odno: 'STALE-KR-BUY', pdno: '005930', sll_buy_dvsn_cd: '02',
    ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '10'
  };
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    rankingRows: [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
    ],
    openOrders: [active],
    openOrdersAfterCancel: [],
    history: [active],
    historyAfterCancel: [
      active,
      {
        odno: 'STALE-KR-CANCEL', orgn_odno: 'STALE-KR-BUY', pdno: '005930',
        sll_buy_dvsn_cd: '02', ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '0',
        cncl_yn: 'Y', cnc_cfrm_qty: '10'
      }
    ]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-24T00:11:29Z', async () => {
        const waiting = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(waiting.decision.reason, /아직 체결되지 않아/);
        assert.equal(state.cancelCalls || 0, 0);
        assert.equal(state.orderCalls || 0, 0);
      });
      await withMockedDate('2026-07-24T00:11:30Z', async () => {
        const canceled = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(canceled.decision.reason, /90초 동안 체결되지 않아 취소를 확인/);
        assert.equal(repo.getOrder(user.id, stale.id).status, 'CANCELED');
        assert.equal(state.cancelCalls, 1);
      });
      await withMockedDate('2026-07-24T00:12:00Z', async () => {
        const requoted = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(requoted.decision.decision, 'BUY');
        assert.equal(requoted.order.status, 'ACCEPTED');
      });
    });

    const buys = repo.listOrders(user.id, { strategyId: strategy.id })
      .filter((order) => order.side === 'BUY');
    assert.equal(buys.length, 2);
    assert.equal(state.orderCalls, 1);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 오래된 BUY 취소 요청만 성공하고 완료가 확인되지 않으면 재호가하지 않는다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-27', entryWindow: 'MORNING',
    status: 'SELECTED', selectedSymbol: '000660', selectedSymbolName: 'SK하이닉스',
    selectedPrice: 200_000, selectedFluctuationRate: 0.16, bought: false
  });
  const stale = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '000660', symbolName: 'SK하이닉스',
    side: 'BUY', entryWindow: 'MORNING', quantity: 2, orderPrice: 200_800,
    estimatedAmount: 401_600, kisOrderNo: 'UNCONFIRMED-BUY', status: 'ACCEPTED',
    filledQuantity: 0, remainingQuantity: 2,
    idempotencyKey: `20260727-${strategy.id}-MORNING-BUY`,
    decisionReason: '취소 미확정 매수', liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_entries SET created_at = '2026-07-27 00:10:00', updated_at = '2026-07-27 00:10:00' WHERE id = ?")
    .run(entry.id);
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-27 00:10:00', updated_at = '2026-07-27 00:10:00' WHERE id = ?")
    .run(stale.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const active = {
    odno: 'UNCONFIRMED-BUY', pdno: '000660', sll_buy_dvsn_cd: '02',
    ord_qty: '2', tot_ccld_qty: '0', rmn_qty: '2'
  };
  const state = {
    cash: 1_000_000,
    prices: { '000660': 200_000 },
    openOrders: [active],
    openOrdersAfterCancel: [active],
    history: [active],
    historyAfterCancel: [active]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-27T00:12:00Z', async () => {
        const blocked = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(blocked.decision.reason, /취소가 확정되지 않아 재주문하지 않습니다/);
      });
    });
    assert.equal(state.cancelCalls, 1);
    assert.equal(state.orderCalls || 0, 0);
    assert.equal(repo.getOrder(user.id, stale.id).status, 'ACCEPTED');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 오래된 BUY가 미체결 목록에 없어도 종결 증거 없이 재주문하지 않는다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-28', entryWindow: 'MORNING',
    status: 'SELECTED', selectedSymbol: '005930', selectedSymbolName: '삼성전자',
    selectedPrice: 70_000, selectedFluctuationRate: 0.16, bought: false
  });
  const stale = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '005930', symbolName: '삼성전자',
    side: 'BUY', entryWindow: 'MORNING', quantity: 10, orderPrice: 70_280,
    estimatedAmount: 702_800, kisOrderNo: 'MISSING-OPEN-BUY', status: 'ACCEPTED',
    filledQuantity: 0, remainingQuantity: 10,
    idempotencyKey: `20260728-${strategy.id}-MORNING-BUY`,
    decisionReason: '미체결 목록에서 사라진 매수', liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_entries SET created_at = '2026-07-28 00:10:00', updated_at = '2026-07-28 00:10:00' WHERE id = ?")
    .run(entry.id);
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-28 00:10:00', updated_at = '2026-07-28 00:10:00' WHERE id = ?")
    .run(stale.id);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const stillUnresolved = {
    odno: 'MISSING-OPEN-BUY', pdno: '005930', sll_buy_dvsn_cd: '02',
    ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '10'
  };
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    openOrders: [],
    history: [stillUnresolved]
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-28T00:12:00Z', async () => {
        const blocked = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(blocked.decision.reason, /아직 체결되지 않아/);
      });
    });
    assert.equal(state.cancelCalls || 0, 0);
    assert.equal(state.orderCalls || 0, 0);
    assert.equal(repo.getOrder(user.id, stale.id).status, 'ACCEPTED');
    assert.equal(repo.listOrders(user.id, { strategyId: strategy.id }).filter((order) => order.side === 'BUY').length, 1);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
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
  seedStableObservations(strategy, '2026-06-09');
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    cash: 1_000_000,
    prices: { '018260': 286_500, '005930': 70_000 }
  };

  await withEnvOverride({ enableLiveOrder: 'false' }, async () => {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-06-09T00:10:00Z', async () => {
        const selected = await service.evaluateStrategy(user.id, strategy.id, { scheduled: true });
        assert.equal(selected.decision.decision, 'SKIP');
        assert.equal(selected.decision.liveOrderEnabled, false);
        assert.match(selected.decision.reason, /후보를 선택했습니다/);
        assert.equal(selected.order, null);
      });
      await withMockedDate('2026-06-09T00:10:30Z', async () => {
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

test('한국 랭킹: 신규 live BUY 전 동일 종목 기존 잔고가 있으면 주문하지 않고 구간을 종료한다', async () => {
  const strategy = createRunningStrategy();
  seedStableObservations(strategy, '2026-07-22', 'MORNING', [
    { symbol: '005930', name: '삼성전자', price: 70_000, fluctuationRate: 0.16 }
  ]);
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    cash: 1_000_000,
    prices: { '005930': 70_000 },
    rankingRows: [
      { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '16.0' }
    ],
    holdings: [{ pdno: '005930', hldg_qty: '10', pchs_avg_pric: '65000', prpr: '70000' }],
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-22T00:10:00Z', async () => {
        const selected = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(selected.decision.reason, /후보를 선택했습니다/);
      });
      const entry = repo.getEntry(strategy.id, '2026-07-22', 'MORNING');
      db.prepare("UPDATE kr_rank_entries SET created_at = '2026-07-22 00:10:00' WHERE id = ?").run(entry.id);
      await withMockedDate('2026-07-22T00:10:30Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(result.decision.reason, /기존 보유 10주/);
      });
    });

    assert.equal(repo.getEntry(strategy.id, '2026-07-22', 'MORNING').status, 'SKIPPED');
    assert.equal(repo.listOrders(user.id, { strategyId: strategy.id }).length, 0);
    assert.equal(state.orderCalls || 0, 0);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: ACCEPTED BUY 체결 증거 없이 보이는 기존 잔고를 전략 포지션으로 채택하지 않는다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-23', entryWindow: 'MORNING', status: 'SELECTED',
    selectedSymbol: '000660', selectedSymbolName: 'SK하이닉스', selectedPrice: 200_000,
    selectedFluctuationRate: 0.10, bought: false
  });
  repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: '000660', symbolName: 'SK하이닉스',
    side: 'BUY', entryWindow: 'MORNING', quantity: 2, orderPrice: 200_000,
    estimatedAmount: 400_000, kisOrderNo: 'UNATTRIBUTED-BUY', status: 'ACCEPTED',
    idempotencyKey: `20260723-${strategy.id}-MORNING-BUY`, decisionReason: '기존 잔고 오인 방지',
    liveOrderEnabled: true
  });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '000660': 200_000 },
    holdings: [{ pdno: '000660', hldg_qty: '10', pchs_avg_pric: '180000', prpr: '200000' }],
    history: [{
      odno: 'UNATTRIBUTED-BUY', pdno: '000660', sll_buy_dvsn_cd: '02',
      ord_qty: '2', tot_ccld_qty: '0', rmn_qty: '2', avg_prvs: '0'
    }],
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-23T00:10:30Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.match(result.decision.reason, /이 전략의 매수 체결 수량은 확인되지 않아/);
      });
    });

    assert.equal(repo.getStrategy(user.id, strategy.id).holdingSymbol, null);
    assert.equal(repo.getEntryById(entry.id).status, 'SELECTED');
    assert.equal(repo.listOrders(user.id, { strategyId: strategy.id }).filter((order) => order.side === 'SELL').length, 0);
    assert.equal(state.orderCalls || 0, 0);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 계좌에 외부 동일 종목 수량이 추가돼도 전략 BUY 수량까지만 손절 매도한다', async () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-24', entryWindow: 'MORNING', status: 'BOUGHT',
    selectedSymbol: '035420', selectedSymbolName: 'NAVER', selectedPrice: 100_000,
    selectedFluctuationRate: 0.10, bought: true
  });
  repo.setHolding(user.id, strategy.id, { symbol: '035420', symbolName: 'NAVER', entryWindow: 'MORNING' });
  createLiveFilledBuy(strategy, {
    symbol: '035420', quantity: 5, averageFilledPrice: 100_000, entryId: entry.id
  });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    prices: { '035420': 90_000 },
    // 전략 5주 외에 사용자가 별도로 보유한 10주가 같은 계좌 잔고에 섞여 있다.
    holdings: [{ pdno: '035420', hldg_qty: '15', pchs_avg_pric: '93000', prpr: '90000' }],
    openOrders: []
  };

  try {
    await withMockedFetch(state, async () => {
      await withMockedDate('2026-07-24T00:20:00Z', async () => {
        const result = await service.evaluateStrategy(user.id, strategy.id);
        assert.equal(result.decision.decision, 'SELL');
        assert.equal(result.order.quantity, 5);
      });
    });
    assert.equal(state.orderCalls, 1);
    assert.equal(state.orderBodies[0].ORD_QTY, '5');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('한국 랭킹: 늦게 동기화한 TIME_LIQUIDATE 손실은 발견일이 아니라 진입 거래일에 귀속한다', () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-25', entryWindow: 'MORNING', status: 'BOUGHT',
    selectedSymbol: 'TIME01', selectedSymbolName: '시간청산', selectedPrice: 1_000,
    selectedFluctuationRate: 0.10, bought: true
  });
  createLiveFilledBuy(strategy, {
    symbol: 'TIME01', quantity: 10, averageFilledPrice: 1_000, entryId: entry.id
  });
  const sell = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: 'TIME01', symbolName: '시간청산',
    side: 'SELL', sellReason: 'TIME_LIQUIDATE', entryWindow: 'MORNING', quantity: 10,
    orderPrice: 900, estimatedAmount: 9_000, kisOrderNo: 'TIME-LOSS-SELL', status: 'FILLED',
    filledQuantity: 10, remainingQuantity: 0, averageFilledPrice: 900,
    idempotencyKey: `20260725-${strategy.id}-MORNING-SELL`, decisionReason: '시간청산 손실',
    liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-25 00:20:00', updated_at = '2026-07-26 00:20:00', filled_at = '2026-07-26 00:20:00' WHERE id = ?")
    .run(sell.id);

  const risk = repo.getLiveLossRiskState(strategy.id, {
    tradeDate: '2026-07-25', since: '2026-07-01 00:00:00'
  });
  assert.equal(risk.lossExitToday, true);
  assert.equal(risk.unresolvedExitToday, false);
  assert.equal(risk.lossExitsToday, 1);
  assert.equal(risk.riskExitsToday, 1);
  assert.equal(risk.consecutiveLossExits, 1);
  const discoveredNextDay = repo.getLiveLossRiskState(strategy.id, {
    tradeDate: '2026-07-26', since: '2026-07-01 00:00:00'
  });
  assert.equal(discoveredNextDay.lossExitToday, false);
  assert.equal(discoveredNextDay.riskExitsToday, 0);
});

test('한국 랭킹: 손익 미확정 청산 1회는 진입 기회를 막지 않고 위험 횟수로만 집계한다', async () => {
  const strategy = createRunningStrategy({ lunchEntryEnabled: true, lunchBudget: 1_000_000 });
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-24', entryWindow: 'MORNING', status: 'BOUGHT',
    selectedSymbol: 'UNKNOWN01', selectedSymbolName: '손익미확정', selectedPrice: 1_000,
    selectedFluctuationRate: 0.16, bought: true
  });
  createLiveFilledBuy(strategy, {
    symbol: 'UNKNOWN01', quantity: 1, averageFilledPrice: 1_000, entryId: entry.id
  });
  const sell = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: 'UNKNOWN01', symbolName: '손익미확정', side: 'SELL',
    sellReason: 'TIME_LIQUIDATE', entryWindow: 'MORNING', quantity: 1, orderPrice: 1_100,
    estimatedAmount: 1_100, kisOrderNo: 'UNKNOWN-PROFIT-SELL', status: 'FILLED',
    filledQuantity: 1, remainingQuantity: 0, averageFilledPrice: null,
    idempotencyKey: `20260724-${strategy.id}-MORNING-SELL`, decisionReason: '손익 미확정',
    liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-24 00:20:00', updated_at = '2026-07-24 00:20:00', filled_at = '2026-07-24 00:20:00' WHERE id = ?")
    .run(sell.id);
  const state = { cash: 1_000_000 };

  await withMockedFetch(state, async () => {
    await withMockedDate('2026-07-24T02:25:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.match(result.decision.reason, /점심 진입 전 관찰/);
      assert.doesNotMatch(result.decision.reason, /손실 회로 차단기/);
    });
  });

  const risk = repo.getLiveLossRiskState(strategy.id, {
    tradeDate: '2026-07-24', since: '2026-07-01 00:00:00'
  });
  assert.equal(risk.unresolvedExitToday, true);
  assert.equal(risk.unresolvedExitsToday, 1);
  assert.equal(risk.riskExitsToday, 1);
  assert.equal(risk.consecutiveRiskExits, 1);
  assert.equal(risk.consecutiveLossExits, 0, '주문 결정가 1,100원을 실체결가로 오인하면 안 된다');
  assert.equal(state.rankingCalls, 1);
  assert.equal(state.orderCalls || 0, 0);
});

test('한국 랭킹: 한 entry의 분할 SELL 여러 건은 연속 손실 한 번으로 센다', () => {
  const strategy = createRunningStrategy();
  const entry = repo.createEntry(user.id, {
    strategyId: strategy.id, tradeDate: '2026-07-26', entryWindow: 'MORNING', status: 'BOUGHT',
    selectedSymbol: 'SPLIT01', selectedSymbolName: '분할청산', selectedPrice: 1_000,
    selectedFluctuationRate: 0.10, bought: true
  });
  createLiveFilledBuy(strategy, {
    symbol: 'SPLIT01', quantity: 10, averageFilledPrice: 1_000, entryId: entry.id
  });
  const partial = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: 'SPLIT01', symbolName: '분할청산',
    side: 'SELL', sellReason: 'STOP_LOSS', entryWindow: 'MORNING', quantity: 10,
    orderPrice: 900, estimatedAmount: 9_000, kisOrderNo: 'SPLIT-PARTIAL', status: 'CANCELED',
    filledQuantity: 4, remainingQuantity: 0, averageFilledPrice: 900,
    idempotencyKey: `20260726-${strategy.id}-MORNING-SELL`, decisionReason: '부분체결',
    liveOrderEnabled: true
  });
  const remainder = repo.createOrder(user.id, {
    strategyId: strategy.id, entryId: entry.id, symbol: 'SPLIT01', symbolName: '분할청산',
    side: 'SELL', sellReason: 'STOP_LOSS', entryWindow: 'MORNING', quantity: 6,
    orderPrice: 890, estimatedAmount: 5_340, kisOrderNo: 'SPLIT-FINAL', status: 'FILLED',
    filledQuantity: 6, remainingQuantity: 0, averageFilledPrice: 890,
    idempotencyKey: `20260726-${strategy.id}-MORNING-SELL`, decisionReason: '잔량체결',
    liveOrderEnabled: true
  });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-26 00:19:00', updated_at = '2026-07-26 00:19:00', filled_at = '2026-07-26 00:19:00' WHERE id = ?")
    .run(partial.id);
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-07-26 00:20:00', updated_at = '2026-07-26 00:20:00', filled_at = '2026-07-26 00:20:00' WHERE id = ?")
    .run(remainder.id);

  const risk = repo.getLiveLossRiskState(strategy.id, {
    tradeDate: '2026-07-26', since: '2026-07-01 00:00:00'
  });
  assert.equal(risk.consecutiveLossExits, 1);
  assert.equal(risk.consecutiveRiskExits, 1);
  assert.equal(risk.lossExitsToday, 1);
  assert.equal(risk.riskExitsToday, 1);
});
