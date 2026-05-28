import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const krRankService = await import('../src/services/krRankService.js');
const repo = await import('../src/repositories/krRankRepository.js');
const autoTradingRepo = await import('../src/repositories/autoTradingRepository.js');

const user = createUser(db, 'kr-rank-fill-sync@example.com');
credentialService.saveSettings(user.id, {
  appKey: 'app-kr-fill',
  appSecret: 'secret-kr-fill',
  accountNumber: '11112222',
  accountProductCode: '01'
});

test.after(() => tmp.cleanup());

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

// KIS 체결조회(TTTC0081R)·토큰 발급만 모킹한 fetch. state.history로 체결 내역을 주입한다.
function withMockedFetch(state, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) {
      return json({ rt_cd: '0', access_token: 'tok-kr-fill', expires_in: 3600 });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-daily-ccld')) {
      state.historyCalls = (state.historyCalls || 0) + 1;
      return json({ rt_cd: '0', output1: state.history || [] });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl')) {
      // 미체결 폴백 — 본 테스트에서는 사용되지 않으므로 빈 응답.
      return json({ rt_cd: '0', output: [] });
    }
    return json({ rt_cd: '0', output: {} });
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function createStrategyForUser() {
  return repo.createStrategy(user.id, {
    morningBudget: 1_000_000,
    lunchBudget: 0,
    morningTargetProfitRate: 0.05,
    morningStopLossRate: 0.03,
    lunchEntryEnabled: false,
    lunchTargetProfitRate: 0.05,
    lunchStopLossRate: 0.03
  });
}

function createAcceptedBuyOrder(strategyId, { symbol = '043590', symbolName = '웰킵스하이텍', kisOrderNo, quantity = 102, orderPrice = 1393, idempotencyKey } = {}) {
  return repo.createOrder(user.id, {
    strategyId,
    symbol,
    symbolName,
    side: 'BUY',
    entryWindow: 'MORNING',
    quantity,
    orderPrice,
    estimatedAmount: quantity * orderPrice,
    kisOrderNo,
    status: 'ACCEPTED',
    idempotencyKey: idempotencyKey || `IDEMP-BUY-${symbol}-${kisOrderNo}`,
    decisionReason: '단위 테스트',
    liveOrderEnabled: true
  });
}

function createAcceptedSellOrder(strategyId, { symbol = '043590', symbolName = '웰킵스하이텍', kisOrderNo, quantity = 102, orderPrice = 1424, idempotencyKey } = {}) {
  return repo.createOrder(user.id, {
    strategyId,
    symbol,
    symbolName,
    side: 'SELL',
    entryWindow: 'MORNING',
    sellReason: 'TARGET',
    quantity,
    orderPrice,
    estimatedAmount: quantity * orderPrice,
    kisOrderNo,
    status: 'ACCEPTED',
    idempotencyKey: idempotencyKey || `IDEMP-SELL-${symbol}-${kisOrderNo}`,
    decisionReason: '단위 테스트',
    liveOrderEnabled: true
  });
}

test('syncOrderFills: 미체결 실주문과 실체결가가 비어 있는 FILLED 주문은 후보로 잡힌다', () => {
  const strategy = createStrategyForUser();
  const accepted = createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'A1' });
  // DRY_RUN은 실주문이 아니라 동기화 대상이 아니다.
  repo.createOrder(user.id, {
    strategyId: strategy.id, symbol: '000111', side: 'BUY', entryWindow: 'MORNING',
    quantity: 1, orderPrice: 100, estimatedAmount: 100, status: 'DRY_RUN',
    idempotencyKey: 'DRY-1', decisionReason: 't', liveOrderEnabled: false
  });
  // 이미 FILLED로 끝났더라도 실체결가가 비어 있으면 과거 이력 보정을 위해 후보다.
  const filledMissingPrice = repo.createOrder(user.id, {
    strategyId: strategy.id, symbol: '000222', side: 'BUY', entryWindow: 'MORNING',
    quantity: 1, orderPrice: 100, estimatedAmount: 100, status: 'FILLED',
    kisOrderNo: 'F1', idempotencyKey: 'FILLED-1', decisionReason: 't', liveOrderEnabled: true
  });
  // 실체결가와 체결수량이 이미 있으면 다시 조회하지 않는다.
  const alreadySynced = repo.createOrder(user.id, {
    strategyId: strategy.id, symbol: '000224', side: 'BUY', entryWindow: 'MORNING',
    quantity: 1, orderPrice: 100, estimatedAmount: 100, status: 'FILLED',
    kisOrderNo: 'F2', idempotencyKey: 'FILLED-2', decisionReason: 't', liveOrderEnabled: true
  });
  repo.updateOrder(user.id, alreadySynced.id, {
    status: 'FILLED',
    filledQuantity: 1,
    remainingQuantity: 0,
    averageFilledPrice: 101
  });
  // kis_order_no가 비어 있으면 KIS 조회로 매칭할 키가 없어 후보가 아니다.
  repo.createOrder(user.id, {
    strategyId: strategy.id, symbol: '000333', side: 'BUY', entryWindow: 'MORNING',
    quantity: 1, orderPrice: 100, estimatedAmount: 100, status: 'ACCEPTED',
    idempotencyKey: 'NOKIS-1', decisionReason: 't', liveOrderEnabled: true
  });
  const candidates = repo.listFillSyncCandidates(user.id, { strategyId: strategy.id });
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.id).sort((a, b) => a - b), [accepted.id, filledMissingPrice.id].sort((a, b) => a - b));
});

test('syncOrderFills: KIS 체결조회로 받은 실체결가·수량을 DB에 채워 넣는다', async () => {
  const strategy = createStrategyForUser();
  const buy = createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'KISBUY-1', symbol: '043591', quantity: 102, orderPrice: 1393 });
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const state = {
    history: [{
      // KIS inquire-daily-ccld 표준 응답 필드
      odno: 'KISBUY-1',
      pdno: '043591',
      sll_buy_dvsn_cd: '02', // 02=매수
      ord_qty: '102',
      tot_ccld_qty: '102',
      nccs_qty: '0',
      avg_prvs: '1396'
    }]
  };
  try {
    await withMockedFetch(state, async () => {
      const updated = await krRankService.syncOrderFills(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 1);
      assert.equal(updated[0].status, 'FILLED');
      assert.equal(Number(updated[0].averageFilledPrice), 1396);
      assert.equal(Number(updated[0].filledQuantity), 102);
    });
    const after = repo.getOrder(user.id, buy.id);
    assert.equal(after.status, 'FILLED');
    assert.equal(Number(after.averageFilledPrice), 1396);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('syncOrderFills: 같은 종목의 여러 주문은 KIS 체결조회를 1회만 호출한다', async () => {
  const strategy = createStrategyForUser();
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'MULTI-1', symbol: '043592', orderPrice: 1393 });
  createAcceptedSellOrder(strategy.id, { kisOrderNo: 'MULTI-2', symbol: '043592', orderPrice: 1424 });
  const state = {
    history: [
      { odno: 'MULTI-1', pdno: '043592', ord_qty: '102', tot_ccld_qty: '102', nccs_qty: '0', avg_prvs: '1396', sll_buy_dvsn_cd: '02' },
      { odno: 'MULTI-2', pdno: '043592', ord_qty: '102', tot_ccld_qty: '102', nccs_qty: '0', avg_prvs: '1423', sll_buy_dvsn_cd: '01' }
    ]
  };
  try {
    await withMockedFetch(state, async () => {
      const updated = await krRankService.syncOrderFills(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 2);
      // 같은 종목 2건이라 KIS 체결조회는 1회만 호출되어야 한다.
      assert.equal(state.historyCalls, 1);
    });
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('syncOrderFills: 체결 정보가 비어 있으면(미체결 상태) 갱신하지 않고 둔다', async () => {
  const strategy = createStrategyForUser();
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const buy = createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'WAIT-1', symbol: '043593' });
  // 체결 0주, 미체결 102주 — 아직 체결 안 됨
  const state = {
    history: [{ odno: 'WAIT-1', pdno: '043593', ord_qty: '102', tot_ccld_qty: '0', nccs_qty: '102', avg_prvs: '0', sll_buy_dvsn_cd: '02' }]
  };
  try {
    await withMockedFetch(state, async () => {
      const updated = await krRankService.syncOrderFills(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 0);
    });
    const after = repo.getOrder(user.id, buy.id);
    // 갱신되지 않아 그대로 ACCEPTED·체결가 미정.
    assert.equal(after.status, 'ACCEPTED');
    assert.equal(after.averageFilledPrice, null);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('listRoundTripOrders: 실주문 매수·매도의 체결가가 비어 있으면 buyPrice/sellPrice를 NULL로 돌려준다', () => {
  const strategy = createStrategyForUser();
  // 실주문 매수 — 접수만 됐고 체결가 없음
  createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'NULL-1', symbol: '111111', orderPrice: 1000 });
  const list = repo.listRoundTripOrders(user.id, { strategyId: strategy.id });
  const row = list.find((r) => r.symbol === '111111');
  assert.ok(row);
  assert.equal(row.buyPrice, null); // 실체결가가 없으면 order_price를 그대로 쓰지 않는다
  assert.equal(row.profitRate, null);
});

test('listRoundTripOrders: DRY_RUN 매수/매도는 order_price 폴백으로 buyPrice를 채운다', () => {
  const strategy = createStrategyForUser();
  // DRY_RUN 매수 — 실체결가는 없지만 시뮬레이션이라 order_price를 보여준다
  const buy = repo.createOrder(user.id, {
    strategyId: strategy.id, symbol: '222222', side: 'BUY', entryWindow: 'MORNING',
    quantity: 10, orderPrice: 5000, estimatedAmount: 50_000, status: 'DRY_RUN',
    idempotencyKey: 'DRY-RT-1', decisionReason: 't', liveOrderEnabled: false
  });
  const sell = repo.createOrder(user.id, {
    strategyId: strategy.id, symbol: '222222', side: 'SELL', entryWindow: 'MORNING',
    sellReason: 'TARGET', quantity: 10, orderPrice: 5100, estimatedAmount: 51_000, status: 'DRY_RUN',
    idempotencyKey: 'DRY-RT-2', decisionReason: 't', liveOrderEnabled: false
  });
  const list = repo.listRoundTripOrders(user.id, { strategyId: strategy.id });
  const row = list.find((r) => r.symbol === '222222');
  assert.ok(row);
  assert.equal(Number(row.buyPrice), 5000);
  assert.equal(Number(row.sellPrice), 5100);
  // (5100 - 5000) / 5000 = 0.02
  assert.ok(Math.abs(Number(row.profitRate) - 0.02) < 1e-9);
  // 사용되지 않는 변수 경고 차단
  assert.ok(buy && sell);
});

test('listRoundTripOrders: 실주문 매수가 체결됐고 매도는 미체결이면 buyPrice는 실체결가, sellPrice는 NULL', () => {
  const strategy = createStrategyForUser();
  const buy = createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'MIX-1', symbol: '333333', orderPrice: 1000 });
  // 매수 체결됨 — average_filled_price 채워둔다
  repo.updateOrder(user.id, buy.id, {
    status: 'FILLED', filledQuantity: 102, remainingQuantity: 0, averageFilledPrice: 1015
  });
  // 매도는 접수만 됨 — 체결가 없음
  createAcceptedSellOrder(strategy.id, { kisOrderNo: 'MIX-2', symbol: '333333', orderPrice: 1050 });
  const list = repo.listRoundTripOrders(user.id, { strategyId: strategy.id });
  const row = list.find((r) => r.symbol === '333333');
  assert.ok(row);
  assert.equal(Number(row.buyPrice), 1015);
  assert.equal(row.sellPrice, null);
  // 매도가 미확정이라 손익률도 NULL.
  assert.equal(row.profitRate, null);
});
