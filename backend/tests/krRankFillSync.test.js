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
      state.historyUrls = [...(state.historyUrls || []), text];
      return json({ rt_cd: '0', output1: state.history || [] });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-period-trade-profit')) {
      state.realizedCalls = (state.realizedCalls || 0) + 1;
      state.realizedUrls = [...(state.realizedUrls || []), text];
      return json({ rt_cd: '0', output1: state.realized || [] });
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
      assert.ok(updated[0].filledAt, '체결 확인 시각을 별도로 기록해야 한다');
    });
    const after = repo.getOrder(user.id, buy.id);
    assert.equal(after.status, 'FILLED');
    assert.equal(Number(after.averageFilledPrice), 1396);
    assert.ok(after.filledAt);
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

test('syncOrderFills: 과거 주문은 주문 생성일 기준 날짜 범위로 KIS 체결조회를 호출한다', async () => {
  const strategy = createStrategyForUser();
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  const buy = createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'PAST-1', symbol: '043594', quantity: 4, orderPrice: 27300 });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-05-28 00:13:23' WHERE id = ?").run(buy.id);
  const state = {
    history: [
      { odno: 'PAST-1', pdno: '043594', ord_qty: '4', tot_ccld_qty: '4', rmn_qty: '0', avg_prvs: '27300', sll_buy_dvsn_cd: '02' }
    ]
  };
  try {
    await withMockedFetch(state, async () => {
      const updated = await krRankService.syncOrderFills(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 1);
    });
    assert.equal(state.historyCalls, 1);
    assert.match(state.historyUrls[0], /INQR_STRT_DT=20260527/);
    assert.match(state.historyUrls[0], /INQR_END_DT=20260529/);
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('syncRealizedProfits: 매도 체결 후 KIS 실현손익·손익률을 매도 주문에 저장한다', async () => {
  const strategy = createStrategyForUser();
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'R-BUY-1', symbol: '403870', symbolName: 'HPSP', quantity: 2, orderPrice: 54500 });
  const sell = createAcceptedSellOrder(strategy.id, { kisOrderNo: 'R-SELL-1', symbol: '403870', symbolName: 'HPSP', quantity: 2, orderPrice: 55500 });
  repo.updateOrder(user.id, sell.id, {
    status: 'FILLED',
    filledQuantity: 2,
    remainingQuantity: 0,
    averageFilledPrice: 55500
  });
  const filledAt = repo.getOrder(user.id, sell.id).filledAt;
  assert.ok(filledAt);
  const state = {
    realized: [{
      trad_dt: '20260609',
      pdno: '403870',
      prdt_name: 'HPSP',
      buy_qty: '2',
      buy_amt: '109000',
      sll_pric: '55500',
      sll_qty: '2',
      sll_amt: '111000',
      rlzt_pfls: '1755',
      pfls_rt: '1.61000000',
      fee: '5',
      tl_tax: '240'
    }]
  };
  try {
    await withMockedFetch(state, async () => {
      const updated = await krRankService.syncRealizedProfits(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 1);
      assert.equal(updated[0].realizedProfitAmount, 1755);
      assert.equal(updated[0].realizedProfitRate, 0.0161);
    });
    const after = repo.getOrder(user.id, sell.id);
    assert.equal(after.realizedProfitAmount, 1755);
    assert.equal(after.realizedProfitRate, 0.0161);
    assert.equal(after.realizedFeeAmount, 5);
    assert.equal(after.realizedTaxAmount, 240);
    assert.equal(after.filledAt, filledAt, '실현손익 동기화가 최초 체결 확인 시각을 덮으면 안 된다');
  } finally {
    autoTradingRepo.updateLiveOrderSetting(user.id, false);
  }
});

test('syncRealizedProfits: KIS가 1% 미만 손익률을 퍼센트 문자열로 주면 100으로 나눠 저장한다', async () => {
  const strategy = createStrategyForUser();
  autoTradingRepo.updateLiveOrderSetting(user.id, true);
  createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'R-BUY-SMALL-LOSS', symbol: '009190', symbolName: '대양금속', quantity: 56, orderPrice: 2350 });
  const sell = createAcceptedSellOrder(strategy.id, { kisOrderNo: 'R-SELL-SMALL-LOSS', symbol: '009190', symbolName: '대양금속', quantity: 56, orderPrice: 2345 });
  repo.updateOrder(user.id, sell.id, {
    status: 'FILLED',
    filledQuantity: 56,
    remainingQuantity: 0,
    averageFilledPrice: 2345
  });
  const state = {
    realized: [{
      trad_dt: '20260529',
      pdno: '009190',
      prdt_name: '대양금속',
      buy_qty: '56',
      buy_amt: '131600',
      sll_pric: '2345',
      sll_qty: '56',
      sll_amt: '131320',
      rlzt_pfls: '-561',
      pfls_rt: '-0.42629179',
      fee: '20',
      tl_tax: '261'
    }]
  };
  try {
    await withMockedFetch(state, async () => {
      const updated = await krRankService.syncRealizedProfits(user.id, { strategyId: strategy.id });
      assert.equal(updated.length, 1);
      assert.equal(updated[0].realizedProfitAmount, -561);
      assert.ok(Math.abs(updated[0].realizedProfitRate - (-0.0042629179)) < 1e-10);
    });
    const after = repo.getOrder(user.id, sell.id);
    assert.ok(Math.abs(after.realizedProfitRate - (-0.0042629179)) < 1e-10);
    assert.equal(after.realizedFeeAmount, 20);
    assert.equal(after.realizedTaxAmount, 261);
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

test('listRoundTripOrders: FILLED 주문은 접수 시각이 아니라 체결 확인 시각을 반환한다', () => {
  const strategy = createStrategyForUser();
  const buy = createAcceptedBuyOrder(strategy.id, { kisOrderNo: 'TIME-BUY', symbol: '444444', orderPrice: 1000 });
  const sell = createAcceptedSellOrder(strategy.id, { kisOrderNo: 'TIME-SELL', symbol: '444444', orderPrice: 1020 });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-05-20 00:00:00' WHERE id IN (?, ?)").run(buy.id, sell.id);
  repo.updateOrder(user.id, buy.id, {
    status: 'FILLED', filledQuantity: 10, remainingQuantity: 0, averageFilledPrice: 1000
  });
  repo.updateOrder(user.id, sell.id, {
    status: 'FILLED', filledQuantity: 10, remainingQuantity: 0, averageFilledPrice: 1020
  });

  const filledBuy = repo.getOrder(user.id, buy.id);
  const filledSell = repo.getOrder(user.id, sell.id);
  const row = repo.listRoundTripOrders(user.id, { strategyId: strategy.id })
    .find((item) => item.symbol === '444444');

  assert.ok(row);
  assert.equal(row.buyTime, filledBuy.filledAt);
  assert.equal(row.sellTime, filledSell.filledAt);
  assert.notEqual(row.sellTime, '2026-05-20 00:00:00');
});

test('0036 마이그레이션: 기존 FILLED 주문의 마지막 갱신 시각을 체결 시각으로 backfill한다', async () => {
  const migrationName = '0036_kr_rank_order_filled_at.sql';

  // 0035까지 적용된 운영 DB를 재현한다. 이 테스트는 파일의 마지막에 두어 현재 스키마를
  // 사용하는 앞선 체결 동기화 테스트들과 격리한다.
  db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(migrationName);
  db.exec('ALTER TABLE kr_rank_orders DROP COLUMN filled_at');

  const strategy = createStrategyForUser();
  const filled = repo.createOrder(user.id, {
    strategyId: strategy.id, symbol: '555551', side: 'BUY', entryWindow: 'MORNING',
    quantity: 3, orderPrice: 1000, estimatedAmount: 3000, status: 'FILLED',
    filledQuantity: 3, remainingQuantity: 0, averageFilledPrice: 1000,
    idempotencyKey: 'LEGACY-FILLED-0036', decisionReason: '0036 업그레이드 테스트', liveOrderEnabled: true
  });
  const accepted = createAcceptedBuyOrder(strategy.id, {
    kisOrderNo: 'LEGACY-ACCEPTED-0036', symbol: '555552', quantity: 1, orderPrice: 2000,
    idempotencyKey: 'LEGACY-ACCEPTED-0036'
  });
  db.prepare(`
    UPDATE kr_rank_orders
    SET created_at = '2026-07-01 00:00:00', updated_at = '2026-07-01 00:05:00'
    WHERE id IN (?, ?)
  `).run(filled.id, accepted.id);

  const { runMigrations } = await import('../src/db/migrate.js');
  runMigrations();

  const filledRow = db.prepare('SELECT status, filled_at FROM kr_rank_orders WHERE id = ?').get(filled.id);
  const acceptedRow = db.prepare('SELECT status, filled_at FROM kr_rank_orders WHERE id = ?').get(accepted.id);
  assert.deepEqual(filledRow, { status: 'FILLED', filled_at: '2026-07-01 00:05:00' });
  assert.deepEqual(acceptedRow, { status: 'ACCEPTED', filled_at: null });
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(migrationName));
});
