import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const backtestService = await import('../src/services/backtestService.js');
const marketCache = await import('../src/repositories/marketPriceCacheRepository.js');

const alice = createUser(db, 'alice@example.com');
const bob = createUser(db, 'bob@example.com');

test.after(() => tmp.cleanup());

function seedDailyRows(userId, stockCode, rows, source = 'KIWOOM') {
  marketCache.upsertDailyPrices(userId, rows.map((r) => ({
    stockCode,
    date: r.date,
    open: r.close,
    high: r.close,
    low: r.close,
    close: r.close,
    volume: 1000,
    source
  })));
}

test('backtest fails clearly when no cached daily rows exist', () => {
  let thrown;
  try {
    backtestService.createRun(alice.id, {
      stockCode: '005930',
      fromDate: '2025-01-01',
      toDate: '2025-01-31',
      totalBudget: 1000000,
      splitCount: 10,
      targetProfitRate: 0.1
    });
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown.status, 400);
  assert.match(thrown.message, /실제 가격/);
});

test('backtest runs over cached close prices and produces summary', () => {
  seedDailyRows(alice.id, '005930', [
    { date: '2025-01-02', close: 50000 },
    { date: '2025-01-03', close: 49000 },
    { date: '2025-01-06', close: 56000 },
    { date: '2025-01-07', close: 60000 }
  ]);
  const run = backtestService.createRun(alice.id, {
    stockCode: '005930',
    fromDate: '2025-01-01',
    toDate: '2025-01-31',
    totalBudget: 1000000,
    splitCount: 10,
    targetProfitRate: 0.1,
    restartAfterSell: false
  });
  assert.equal(run.status, 'COMPLETED');
  assert.ok(run.totalBuyCount >= 1);
  assert.ok(run.totalSellCount >= 1);
  assert.equal(run.notice, '투자 수익을 보장하지 않습니다.');
  const trades = backtestService.listTrades(alice.id, run.id);
  assert.ok(trades.length >= 2);
  for (const t of trades) {
    assert.ok(['BUY', 'SELL', 'HOLD', 'COMPLETED'].includes(t.side));
  }
});

test('cross-user backtest run access returns 404', () => {
  const aliceRun = backtestService.listRuns(alice.id)[0];
  let thrown;
  try {
    backtestService.getRun(bob.id, aliceRun.id);
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown.status, 404);
});

test('bob cannot use alice cached rows even if same stock code', () => {
  let thrown;
  try {
    backtestService.createRun(bob.id, {
      stockCode: '005930',
      fromDate: '2025-01-01',
      toDate: '2025-01-31',
      totalBudget: 1000000,
      splitCount: 10,
      targetProfitRate: 0.1
    });
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown.status, 400);
});

test('backtest refuses non-kiwoom daily rows', () => {
  seedDailyRows(alice.id, '035420', [
    { date: '2025-02-03', close: 200000 },
    { date: '2025-02-04', close: 205000 }
  ], 'LEGACY');
  let thrown;
  try {
    backtestService.createRun(alice.id, {
      stockCode: '035420',
      fromDate: '2025-02-01',
      toDate: '2025-02-28',
      totalBudget: 1000000,
      splitCount: 10,
      targetProfitRate: 0.1
    });
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown.status, 400);
  assert.match(thrown.message, /실제 가격/);
});

test('restartAfterSell=true allows a second buy cycle in the run', () => {
  seedDailyRows(alice.id, '000660', [
    { date: '2025-01-02', close: 50000 },
    { date: '2025-01-03', close: 56000 },
    { date: '2025-01-04', close: 50000 },
    { date: '2025-01-07', close: 56000 }
  ]);
  const run = backtestService.createRun(alice.id, {
    stockCode: '000660',
    fromDate: '2025-01-01',
    toDate: '2025-01-31',
    totalBudget: 1000000,
    splitCount: 10,
    targetProfitRate: 0.1,
    restartAfterSell: true
  });
  assert.equal(run.status, 'COMPLETED');
  assert.ok(run.totalBuyCount >= 2);
  assert.ok(run.totalSellCount >= 2);
});
