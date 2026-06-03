import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

test('왕복 주문 이력은 실패·미체결(관망) 건을 제외하고 실제 매수/매도만 보여준다', () => {
  // 한국장: 체결된 매수 1건 + 실패한 매수 1건 → 왕복 이력엔 체결 건만.
  const kr = krService.createStrategy(alice.id, {
    autoBudgetEnabled: false, morningBudget: 1_000_000, morningTargetProfitRate: 0.02, morningStopLossRate: 0.05,
    morningLiquidateTime: null, lunchEntryEnabled: false, lunchBudget: 0, lunchTargetProfitRate: null, lunchStopLossRate: null, lunchLiquidateTime: null
  });
  krRepo.createOrder(alice.id, {
    strategyId: kr.id, symbol: '000010', symbolName: '체결종목', side: 'BUY', entryWindow: 'MORNING',
    quantity: 10, orderPrice: 10000, estimatedAmount: 100000, status: 'DRY_RUN',
    idempotencyKey: 'kr-ok-buy', decisionReason: '매수', liveOrderEnabled: false
  });
  krRepo.createOrder(alice.id, {
    strategyId: kr.id, symbol: '000020', symbolName: '실패종목', side: 'BUY', entryWindow: 'MORNING',
    quantity: 5, orderPrice: 20000, estimatedAmount: 100000, status: 'FAILED',
    idempotencyKey: 'kr-failed-buy', decisionReason: '매수', liveOrderEnabled: true, errorMessage: 'KIS 거절'
  });
  const krHistory = krService.listRoundTripOrders(alice.id, kr.id, { limit: 50 });
  assert.equal(krHistory.total, 1);
  assert.equal(krHistory.items.length, 1);
  assert.equal(krHistory.items[0].symbol, '000010');

  // 미국장: CLOSED 매매 1건 + FAILED 매매 다수 → 왕복 이력엔 CLOSED만(아카리식 연속 FAILED 노이즈 차단).
  const us = usService.createStrategy(alice.id, {
    autoBudgetEnabled: true, fixedBuyUsdAmount: 0, targetProfitRate: 0.02, stopLossRate: 0.05,
    forceCloseKst: '04:30', exchange: 'NAS', cycleTargetProfitRate: null
  });
  const okTrade = usRepo.createTrade(alice.id, {
    strategyId: us.id, tradeDate: '2026-05-27', tradeSeq: 1, symbol: 'AAA', symbolName: 'AAA', exchange: 'NAS', selectedPrice: 10, status: 'BOUGHT'
  });
  usRepo.updateTradeOutcome(okTrade.id, { status: 'CLOSED', entryPrice: 10, entryQuantity: 3, exitPrice: 11, exitReason: 'TARGET', profitRate: 0.1, close: true });
  for (let i = 0; i < 5; i += 1) {
    const failed = usRepo.createTrade(alice.id, {
      strategyId: us.id, tradeDate: '2026-05-27', tradeSeq: 2 + i, symbol: 'BBB', symbolName: '실패', exchange: 'NAS', selectedPrice: 18.27, status: 'SELECTED'
    });
    usRepo.updateTradeOutcome(failed.id, { status: 'FAILED', errorMessage: '미체결', close: true });
  }
  const usHistory = usService.listRoundTripOrders(alice.id, us.id, { limit: 50 });
  assert.equal(usHistory.total, 1);
  assert.equal(usHistory.items.length, 1);
  assert.equal(usHistory.items[0].symbol, 'AAA');
});

test('랭킹 자동매매 화면은 탭 순서, 홈 진입 카드, 왕복 주문 이력, 판단 로그 10개 표시를 갖는다', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const app = fs.readFileSync(path.join(root, 'frontend/src/pages/AutoTradingPage.jsx'), 'utf8');
  const appShell = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'frontend/src/pages/StrategiesPage.jsx'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'frontend/src/pages/DashboardPage.jsx'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  const krPanel = fs.readFileSync(path.join(root, 'frontend/src/pages/KrRankAutoTradingPanel.jsx'), 'utf8');
  const usPanel = fs.readFileSync(path.join(root, 'frontend/src/pages/UsRankAutoTradingPanel.jsx'), 'utf8');

  assert.match(app, /useState\(initialStrategy \? 'laor' : 'kr-rank'\)/);
  assert.ok(app.indexOf('한국 국장 상승률 랭킹 전략') < app.indexOf('미국장 상승률 랭킹 전략'));
  assert.ok(app.indexOf('미국장 상승률 랭킹 전략') < app.indexOf('라오어 무한매수법'));
  assert.match(home, /top-nav/);
  assert.match(home, /티끌모아 태산/);
  assert.match(home, /label: '대시보드'/);
  assert.doesNotMatch(home, /주문\/체결 로그/);
  assert.doesNotMatch(home, /key: 'strategies'/);
  assert.doesNotMatch(appShell, /history\.back/);
  assert.match(appShell, /onOpenDashboard=\{\(\) => setView\('strategies', \{ replace: true \}\)\}/);
  assert.match(dashboard, /<h2>대시보드<\/h2>/);
  assert.match(dashboard, /계좌 요약/);
  assert.match(dashboard, /기간별 수익률/);
  assert.match(dashboard, /전략별 상태/);
  assert.ok(dashboard.indexOf('<PeriodReturnsPanel') < dashboard.indexOf('<h3>전략별 상태</h3>'));
  assert.match(dashboard, /최근 주문\/체결/);
  assert.doesNotMatch(dashboard, /className="home-actions"/);
  assert.match(dashboard, /백테스트/);
  assert.match(dashboard, /자동매매/);
  assert.match(dashboard, /KIS 설정/);
  assert.match(dashboard, /체크리스트/);
  assert.doesNotMatch(dashboard, /시작 체크리스트/);
  assert.doesNotMatch(dashboard, /최근 활동/);
  assert.doesNotMatch(dashboard, /최근 백테스트/);
  // 재설계: 히어로 KPI 스트립과 하단 조용한 바로가기를 쓰고, 상단 메뉴와 중복되는
  // 헤더 액션 바·status-pill 혼용은 제거한다. metric 라벨은 metric-label 클래스로 통일.
  assert.match(dashboard, /kpi-strip/);
  assert.match(dashboard, /periodReturns/);
  assert.match(dashboard, /dashboard-quicklinks/);
  assert.match(dashboard, /className="metric-label"/);
  assert.doesNotMatch(dashboard, /dashboard-secondary-actions/);
  assert.doesNotMatch(dashboard, /status-pill/);
  assert.match(indexHtml, /favicon\.svg/);
  assert.match(indexHtml, /전략 운용 대시보드/);

  for (const panel of [krPanel, usPanel]) {
    assert.match(panel, /매수 시각\(KST\)/);
    assert.match(panel, /매도가/);
    assert.match(panel, /손익/);
    assert.match(panel, /usePagedList\(list.*Decisions, 10\)/);
    assert.match(panel, /LoadMoreFooter/);
  }
  assert.match(app, /usePagedList\(listAutoTradingOrders\)/);
  assert.match(app, /usePagedList\(listAutoTradingDecisions, 10\)/);
  assert.match(app, /<OrdersTable/);
  assert.match(app, /<DecisionLogTable/);
  assert.match(app, /LoadMoreFooter/);
  assert.doesNotMatch(app, /LatestPosition/);
  assert.equal(/<EntryTable/.test(krPanel), false);
  assert.equal(/<TradeTable/.test(usPanel), false);
  // 기간별 수익률 패널이 국장·미국장·라오어 탭에 각각 전략 종류별로 붙어야 한다.
  assert.match(app, /<StrategyPeriodReturns[^>]*strategyType="laor"/);
  assert.match(krPanel, /<StrategyPeriodReturns[^>]*strategyType="kr-rank"/);
  assert.match(usPanel, /<StrategyPeriodReturns[^>]*strategyType="us-rank"/);
});
