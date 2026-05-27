import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const krService = await import('../src/services/krRankService.js');
const usService = await import('../src/services/usRankService.js');
const krRepo = await import('../src/repositories/krRankRepository.js');
const usRepo = await import('../src/repositories/usRankRepository.js');

const alice = createUser(db, 'rank-history-alice@example.com');
const bob = createUser(db, 'rank-history-bob@example.com');

test.after(() => tmp.cleanup());

test('한국 랭킹 전략 삭제는 전략만 숨기고 주문·판단·진입 이력을 보존한다', () => {
  const strategy = krService.createStrategy(alice.id, {
    autoBudgetEnabled: false,
    morningBudget: 1_000_000,
    morningTargetProfitRate: 0.02,
    morningStopLossRate: 0.05,
    morningLiquidateTime: null,
    lunchEntryEnabled: false,
    lunchBudget: 0,
    lunchTargetProfitRate: null,
    lunchStopLossRate: null,
    lunchLiquidateTime: null
  });
  krService.startStrategy(alice.id, strategy.id);
  const entry = krRepo.createEntry(alice.id, {
    strategyId: strategy.id,
    tradeDate: '2026-05-27',
    entryWindow: 'MORNING',
    status: 'BOUGHT',
    selectedSymbol: '000001',
    selectedSymbolName: '테스트',
    selectedPrice: 10000,
    selectedFluctuationRate: 0.05,
    bought: true
  });
  krRepo.createOrder(alice.id, {
    strategyId: strategy.id,
    entryId: entry.id,
    symbol: '000001',
    symbolName: '테스트',
    side: 'BUY',
    entryWindow: 'MORNING',
    quantity: 10,
    orderPrice: 10000,
    estimatedAmount: 100000,
    status: 'DRY_RUN',
    idempotencyKey: 'kr-history-buy',
    decisionReason: '테스트 매수',
    liveOrderEnabled: false
  });
  krRepo.createOrder(alice.id, {
    strategyId: strategy.id,
    symbol: '000001',
    symbolName: '테스트',
    side: 'SELL',
    entryWindow: 'MORNING',
    sellReason: 'TARGET',
    quantity: 10,
    orderPrice: 10300,
    estimatedAmount: 103000,
    status: 'DRY_RUN',
    idempotencyKey: 'kr-history-sell',
    decisionReason: '테스트 매도',
    liveOrderEnabled: false
  });
  krRepo.createDecisionLog(alice.id, {
    strategyId: strategy.id,
    decision: 'SELL',
    sellReason: 'TARGET',
    selectedSymbol: '000001',
    selectedSymbolName: '테스트',
    currentPrice: 10300,
    averagePrice: 10000,
    holdingQuantity: 10,
    liveOrderEnabled: false,
    evaluationSource: 'MANUAL',
    reason: '테스트 판단'
  });

  assert.equal(krRepo.listRunningStrategies().some((item) => item.id === strategy.id), true);
  krService.deleteStrategy(alice.id, strategy.id);

  assert.equal(krService.listStrategies(alice.id).some((item) => item.id === strategy.id), false);
  assert.equal(krRepo.listRunningStrategies().some((item) => item.id === strategy.id), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kr_rank_orders WHERE strategy_id = ?').get(strategy.id).n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kr_rank_decision_logs WHERE strategy_id = ?').get(strategy.id).n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kr_rank_entries WHERE strategy_id = ?').get(strategy.id).n, 1);

  const history = krService.listRoundTripOrders(alice.id, strategy.id, { limit: 10 });
  assert.equal(history.total, 1);
  assert.equal(history.items[0].symbol, '000001');
  assert.equal(history.items[0].sellReason, 'TARGET');
  assert.equal(Number(history.items[0].profitRate.toFixed(3)), 0.03);
  assert.throws(() => krService.listRoundTripOrders(bob.id, strategy.id, { limit: 10 }), /찾을 수 없습니다/);
});

test('미국장 랭킹 전략 삭제는 전략만 숨기고 주문·판단·매매 이력을 보존한다', () => {
  const strategy = usService.createStrategy(alice.id, {
    autoBudgetEnabled: true,
    fixedBuyUsdAmount: 0,
    targetProfitRate: 0.02,
    stopLossRate: 0.05,
    forceCloseKst: '04:30',
    exchange: 'NAS',
    cycleTargetProfitRate: null
  });
  usRepo.startStrategy(alice.id, strategy.id);
  const trade = usRepo.createTrade(alice.id, {
    strategyId: strategy.id,
    tradeDate: '2026-05-27',
    tradeSeq: 1,
    symbol: 'TQQQ',
    symbolName: 'TQQQ',
    exchange: 'NAS',
    selectedPrice: 50,
    selectedFluctuationRate: 0.12,
    status: 'BOUGHT'
  });
  usRepo.updateTradeOutcome(trade.id, {
    status: 'CLOSED',
    entryPrice: 50,
    entryQuantity: 20,
    exitPrice: 52,
    exitReason: 'TARGET',
    profitRate: 0.04,
    close: true
  });
  usRepo.createOrder(alice.id, {
    strategyId: strategy.id,
    tradeId: trade.id,
    symbol: 'TQQQ',
    symbolName: 'TQQQ',
    exchange: 'NAS',
    side: 'BUY',
    quantity: 20,
    orderPrice: 50,
    estimatedAmount: 1000,
    status: 'DRY_RUN',
    idempotencyKey: 'us-history-buy',
    decisionReason: '테스트 매수',
    liveOrderEnabled: false
  });
  usRepo.createOrder(alice.id, {
    strategyId: strategy.id,
    tradeId: trade.id,
    symbol: 'TQQQ',
    symbolName: 'TQQQ',
    exchange: 'NAS',
    side: 'SELL',
    sellReason: 'TARGET',
    quantity: 20,
    orderPrice: 52,
    estimatedAmount: 1040,
    status: 'DRY_RUN',
    idempotencyKey: 'us-history-sell',
    decisionReason: '테스트 매도',
    liveOrderEnabled: false
  });
  usRepo.createDecisionLog(alice.id, {
    strategyId: strategy.id,
    tradeId: trade.id,
    tradeDate: '2026-05-27',
    tradeSeq: 1,
    decision: 'SELL',
    sellReason: 'TARGET',
    selectedSymbol: 'TQQQ',
    selectedSymbolName: 'TQQQ',
    selectedExchange: 'NAS',
    currentPrice: 52,
    averagePrice: 50,
    holdingQuantity: 20,
    liveOrderEnabled: false,
    evaluationSource: 'MANUAL',
    reason: '테스트 판단'
  });

  assert.equal(usRepo.listRunningStrategies().some((item) => item.id === strategy.id), true);
  usService.deleteStrategy(alice.id, strategy.id);

  assert.equal(usService.listStrategies(alice.id).some((item) => item.id === strategy.id), false);
  assert.equal(usRepo.listRunningStrategies().some((item) => item.id === strategy.id), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM us_rank_orders WHERE strategy_id = ?').get(strategy.id).n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM us_rank_decision_logs WHERE strategy_id = ?').get(strategy.id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM us_rank_trades WHERE strategy_id = ?').get(strategy.id).n, 1);

  const history = usService.listRoundTripOrders(alice.id, strategy.id, { limit: 10 });
  assert.equal(history.total, 1);
  assert.equal(history.items[0].symbol, 'TQQQ');
  assert.equal(history.items[0].currency, 'USD');
  assert.equal(history.items[0].profitRate, 0.04);
  assert.throws(() => usService.listRoundTripOrders(bob.id, strategy.id, { limit: 10 }), /찾을 수 없습니다/);
});

test('랭킹 자동매매 화면은 탭 순서, 홈 진입 카드, 왕복 주문 이력, 판단 로그 10개 표시를 갖는다', () => {
  const root = path.resolve('../');
  const app = fs.readFileSync(path.join(root, 'frontend/src/pages/AutoTradingPage.jsx'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'frontend/src/pages/StrategiesPage.jsx'), 'utf8');
  const krPanel = fs.readFileSync(path.join(root, 'frontend/src/pages/KrRankAutoTradingPanel.jsx'), 'utf8');
  const usPanel = fs.readFileSync(path.join(root, 'frontend/src/pages/UsRankAutoTradingPanel.jsx'), 'utf8');

  assert.match(app, /useState\(initialStrategy \? 'laor' : 'kr-rank'\)/);
  assert.ok(app.indexOf('한국 국장 상승률 랭킹 전략') < app.indexOf('미국장 상승률 랭킹 전략'));
  assert.ok(app.indexOf('미국장 상승률 랭킹 전략') < app.indexOf('라오어 무한매수법'));
  assert.match(home, /className="home-actions"/);
  assert.match(home, /백테스트/);
  assert.match(home, /자동매매/);
  assert.match(home, /KIS 설정/);

  for (const panel of [krPanel, usPanel]) {
    assert.match(panel, /매수 시각\(KST\)/);
    assert.match(panel, /매도가/);
    assert.match(panel, /손익/);
    assert.match(panel, /usePagedList\(list.*Decisions, 10\)/);
  }
  assert.equal(/<EntryTable/.test(krPanel), false);
  assert.equal(/<TradeTable/.test(usPanel), false);
});
