import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const usRankService = await import('../src/services/usRankService.js');
const repo = await import('../src/repositories/usRankRepository.js');
const autoTradingRepo = await import('../src/repositories/autoTradingRepository.js');

const user = createUser(db, 'us-rank-fill-sync@example.com');
credentialService.saveSettings(user.id, {
  appKey: 'app-us-fill',
  appSecret: 'secret-us-fill',
  accountNumber: '33334444',
  accountProductCode: '01'
});

test.after(() => tmp.cleanup());

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

// KIS 해외 체결조회(TTTS3035R, inquire-ccnl)·토큰 발급만 모킹한 fetch.
function withMockedFetch(state, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) {
      return json({ rt_cd: '0', access_token: 'tok-us-fill', expires_in: 3600 });
    }
    if (text.includes('/uapi/overseas-stock/v1/trading/inquire-ccnl')) {
      state.historyCalls = (state.historyCalls || 0) + 1;
      return json({ rt_cd: '0', output: state.history || [] });
    }
    return json({ rt_cd: '0', output: {} });
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function createStrategy() {
  return repo.createStrategy(user.id, {
    autoBudgetEnabled: true,
    fixedBuyUsdAmount: 0,
    targetProfitRate: 0.02,
    stopLossRate: 0.05,
    forceCloseKst: '04:30',
    exchange: 'NAS',
    cycleTargetProfitRate: null
  });
}

function createTrade(strategyId, { symbol, tradeSeq = 1, tradeDate = '2026-05-28', exchange = 'NAS', status = 'BOUGHT', entryPrice = null, entryQuantity = null } = {}) {
  const trade = repo.createTrade(user.id, {
    strategyId, tradeDate, tradeSeq, symbol, symbolName: symbol, exchange, selectedPrice: 50, status: status === 'CLOSED' ? 'BOUGHT' : status
  });
  if (entryPrice != null || entryQuantity != null || status === 'CLOSED') {
    repo.updateTradeOutcome(trade.id, {
      ...(status === 'CLOSED' ? { status: 'CLOSED', close: true } : {}),
      ...(entryPrice != null ? { entryPrice } : {}),
      ...(entryQuantity != null ? { entryQuantity } : {})
    });
  }
  return repo.getOpenTrade(strategyId) || trade;
}

function createAcceptedBuyOrder(strategyId, { tradeId, symbol, exchange = 'NAS', kisOrderNo, quantity = 10, orderPrice = 50, idempotencyKey } = {}) {
  return repo.createOrder(user.id, {
    strategyId,
    tradeId,
    symbol,
    symbolName: symbol,
    exchange,
    side: 'BUY',
    quantity,
    orderPrice,
    estimatedAmount: quantity * orderPrice,
    kisOrderNo,
    status: 'ACCEPTED',
    idempotencyKey: idempotencyKey || `US-IDEMP-BUY-${symbol}-${kisOrderNo}`,
    decisionReason: '단위 테스트',
    liveOrderEnabled: true
  });
}

function createAcceptedSellOrder(strategyId, { tradeId, symbol, exchange = 'NAS', kisOrderNo, quantity = 10, orderPrice = 52, idempotencyKey } = {}) {
  return repo.createOrder(user.id, {
    strategyId,
    tradeId,
    symbol,
    symbolName: symbol,
    exchange,
    side: 'SELL',
    sellReason: 'TARGET',
    quantity,
    orderPrice,
    estimatedAmount: quantity * orderPrice,
    kisOrderNo,
    status: 'ACCEPTED',
    idempotencyKey: idempotencyKey || `US-IDEMP-SELL-${symbol}-${kisOrderNo}`,
    decisionReason: '단위 테스트',
    liveOrderEnabled: true
  });
}

test('syncOrderFills (US): 미체결 실주문과 실체결가가 비어 있는 FILLED 주문은 후보로 잡힌다', () => {
  const strategy = createStrategy();
  const trade = createTrade(strategy.id, { symbol: 'CAND1' });
  const accepted = createAcceptedBuyOrder(strategy.id, { tradeId: trade.id, symbol: 'CAND1', kisOrderNo: 'A1' });
  // DRY_RUN은 후보가 아니다.
  repo.createOrder(user.id, {
    strategyId: strategy.id, tradeId: trade.id, symbol: 'CAND2', side: 'BUY',
    quantity: 1, orderPrice: 100, estimatedAmount: 100, exchange: 'NAS',
    status: 'DRY_RUN', idempotencyKey: 'US-DRY-1', decisionReason: 't', liveOrderEnabled: false
  });
  // 이미 FILLED로 끝났더라도 실체결가가 비어 있으면 과거 이력 보정을 위해 후보다.
  const filledMissingPrice = repo.createOrder(user.id, {
    strategyId: strategy.id, tradeId: trade.id, symbol: 'CAND3', side: 'BUY',
    quantity: 1, orderPrice: 100, estimatedAmount: 100, exchange: 'NAS', kisOrderNo: 'F1',
    status: 'FILLED', idempotencyKey: 'US-FIL-1', decisionReason: 't', liveOrderEnabled: true
  });
  const alreadySynced = repo.createOrder(user.id, {
    strategyId: strategy.id, tradeId: trade.id, symbol: 'CAND5', side: 'BUY',
    quantity: 1, orderPrice: 100, estimatedAmount: 100, exchange: 'NAS', kisOrderNo: 'F2',
    status: 'FILLED', idempotencyKey: 'US-FIL-2', decisionReason: 't', liveOrderEnabled: true
  });
  repo.updateOrder(user.id, alreadySynced.id, {
    status: 'FILLED',
    filledQuantity: 1,
    remainingQuantity: 0,
    averageFilledPrice: 100.2
  });
  // kis_order_no가 없으면 매칭 불가라 후보가 아니다.
  repo.createOrder(user.id, {
    strategyId: strategy.id, tradeId: trade.id, symbol: 'CAND4', side: 'BUY',
    quantity: 1, orderPrice: 100, estimatedAmount: 100, exchange: 'NAS',
    status: 'ACCEPTED', idempotencyKey: 'US-NOKIS-1', decisionReason: 't', liveOrderEnabled: true
  });
  const candidates = repo.listFillSyncCandidates(user.id, { strategyId: strategy.id });
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.id).sort((a, b) => a - b), [accepted.id, filledMissingPrice.id].sort((a, b) => a - b));
});

test('syncOrderFills (US): 매수 주문 실체결가·체결수량을 KIS inquire-ccnl 응답으로 DB에 반영한다', async () => {
  const strategy = createStrategy();
  const trade = createTrade(strategy.id, { symbol: 'TQQQ' });
  const buy = createAcceptedBuyOrder(strategy.id, { tradeId: trade.id, symbol: 'TQQQ', kisOrderNo: 'USORD1', quantity: 20, orderPrice: 50 });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    history: [{
      // KIS 해외 체결조회(TTTS3035R) 응답 표준 필드
      odno: 'USORD1',
      ovrs_pdno: 'TQQQ',
      sll_buy_dvsn_cd: '02',
      ord_qty: '20',
      tot_ccld_qty: '20',
      nccs_qty: '0',
      ft_ccld_unpr3: '50.25'
    }]
  };
  try {
    await withMockedFetch(state, async () => {
      const updated = await usRankService.syncOrderFills(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 1);
      assert.equal(updated[0].status, 'FILLED');
      assert.ok(Math.abs(Number(updated[0].averageFilledPrice) - 50.25) < 1e-9);
      assert.equal(Number(updated[0].filledQuantity), 20);
    });
    const after = repo.getOrder(user.id, buy.id);
    assert.equal(after.status, 'FILLED');
    assert.ok(Math.abs(Number(after.averageFilledPrice) - 50.25) < 1e-9);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('syncOrderFills (US): 같은 (symbol, exchange) 여러 주문은 inquire-ccnl을 1회만 호출한다', async () => {
  const strategy = createStrategy();
  const trade = createTrade(strategy.id, { symbol: 'MULTI' });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  createAcceptedBuyOrder(strategy.id, { tradeId: trade.id, symbol: 'MULTI', kisOrderNo: 'M1', quantity: 10, orderPrice: 50 });
  createAcceptedSellOrder(strategy.id, { tradeId: trade.id, symbol: 'MULTI', kisOrderNo: 'M2', quantity: 10, orderPrice: 52 });
  const state = {
    history: [
      { odno: 'M1', ovrs_pdno: 'MULTI', ord_qty: '10', tot_ccld_qty: '10', nccs_qty: '0', ft_ccld_unpr3: '50.10', sll_buy_dvsn_cd: '02' },
      { odno: 'M2', ovrs_pdno: 'MULTI', ord_qty: '10', tot_ccld_qty: '10', nccs_qty: '0', ft_ccld_unpr3: '52.00', sll_buy_dvsn_cd: '01' }
    ]
  };
  try {
    await withMockedFetch(state, async () => {
      const updated = await usRankService.syncOrderFills(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 2);
      assert.equal(state.historyCalls, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('syncOrderFills (US): 체결 정보가 비어 있으면(미체결) 갱신하지 않는다', async () => {
  const strategy = createStrategy();
  const trade = createTrade(strategy.id, { symbol: 'WAIT' });
  const buy = createAcceptedBuyOrder(strategy.id, { tradeId: trade.id, symbol: 'WAIT', kisOrderNo: 'WAIT1', quantity: 10, orderPrice: 50 });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    history: [{ odno: 'WAIT1', ovrs_pdno: 'WAIT', ord_qty: '10', tot_ccld_qty: '0', nccs_qty: '10', ft_ccld_unpr3: '0', sll_buy_dvsn_cd: '02' }]
  };
  try {
    await withMockedFetch(state, async () => {
      const updated = await usRankService.syncOrderFills(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 0);
    });
    const after = repo.getOrder(user.id, buy.id);
    assert.equal(after.status, 'ACCEPTED');
    assert.equal(after.averageFilledPrice, null);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('listRoundTripOrders (US): 실주문 매수 체결가가 채워지면 trade.entry_price 대신 그 값을 우선 쓴다', () => {
  const strategy = createStrategy();
  // trade에는 KIS 잔고 평단(50)이 들어가 있고, 주문 행에는 KIS 체결가(50.25)가 들어왔다.
  // 주문 행이 더 정확하므로 그 값을 buy_price로 우선 노출한다.
  const trade = createTrade(strategy.id, { symbol: 'PREF', tradeSeq: 11, entryPrice: 50, entryQuantity: 20 });
  const buy = createAcceptedBuyOrder(strategy.id, { tradeId: trade.id, symbol: 'PREF', kisOrderNo: 'PREF1', quantity: 20, orderPrice: 49.5 });
  repo.updateOrder(user.id, buy.id, {
    status: 'FILLED', filledQuantity: 20, remainingQuantity: 0, averageFilledPrice: 50.25
  });
  const list = repo.listRoundTripOrders(user.id, { strategyId: strategy.id });
  const row = list.find((r) => r.symbol === 'PREF');
  assert.ok(row);
  assert.ok(Math.abs(Number(row.buyPrice) - 50.25) < 1e-9);
});

test('listRoundTripOrders (US): 실주문 매수가 미체결이면 trade.entry_price가 있어도 buy_price는 NULL', () => {
  const strategy = createStrategy();
  const trade = createTrade(strategy.id, { symbol: 'EMPTY', tradeSeq: 21, entryPrice: 31.5 });
  createAcceptedBuyOrder(strategy.id, { tradeId: trade.id, symbol: 'EMPTY', kisOrderNo: 'EMP1', quantity: 10, orderPrice: 30 });
  const list = repo.listRoundTripOrders(user.id, { strategyId: strategy.id });
  const row = list.find((r) => r.symbol === 'EMPTY');
  assert.ok(row);
  assert.equal(row.buyPrice, null);
});

test('listRoundTripOrders (US): DRY_RUN 매수/매도는 order_price 폴백으로 화면에 가격을 보여 준다', () => {
  const strategy = createStrategy();
  const trade = repo.createTrade(user.id, {
    strategyId: strategy.id, tradeDate: '2026-05-28', tradeSeq: 31,
    symbol: 'DRY', symbolName: 'DRY', exchange: 'NAS', selectedPrice: 10, status: 'BOUGHT'
  });
  repo.updateTradeOutcome(trade.id, { status: 'CLOSED', exitReason: 'TARGET', close: true });
  // 둘 다 DRY_RUN — entry_price·exit_price 미설정. order_price 폴백으로 노출되어야 한다.
  repo.createOrder(user.id, {
    strategyId: strategy.id, tradeId: trade.id, symbol: 'DRY', side: 'BUY',
    quantity: 5, orderPrice: 10, estimatedAmount: 50, exchange: 'NAS',
    status: 'DRY_RUN', idempotencyKey: 'US-RT-DRY-1', decisionReason: 't', liveOrderEnabled: false
  });
  repo.createOrder(user.id, {
    strategyId: strategy.id, tradeId: trade.id, symbol: 'DRY', side: 'SELL',
    sellReason: 'TARGET', quantity: 5, orderPrice: 11, estimatedAmount: 55, exchange: 'NAS',
    status: 'DRY_RUN', idempotencyKey: 'US-RT-DRY-2', decisionReason: 't', liveOrderEnabled: false
  });
  const list = repo.listRoundTripOrders(user.id, { strategyId: strategy.id });
  const row = list.find((r) => r.symbol === 'DRY');
  assert.ok(row);
  assert.equal(Number(row.buyPrice), 10);
  assert.equal(Number(row.sellPrice), 11);
});
