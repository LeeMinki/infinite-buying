import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const backtestService = await import('../src/services/backtestService.js');
const marketCache = await import('../src/repositories/marketPriceCacheRepository.js');

const alice = createUser(db, 'alice@example.com');
const bob = createUser(db, 'bob@example.com');

marketCache.upsertDailyPrices(alice.id, [
  { stockCode: '005930', date: '2025-01-02', open: 50000, high: 50000, low: 50000, close: 50000, volume: 100, source: 'KIWOOM' },
  { stockCode: '005930', date: '2025-01-03', open: 56000, high: 56000, low: 56000, close: 56000, volume: 100, source: 'KIWOOM' }
]);

const aliceBacktest = backtestService.createRun(alice.id, {
  stockCode: '005930',
  fromDate: '2025-01-01',
  toDate: '2025-01-31',
  totalBudget: 1000000,
  splitCount: 10,
  targetProfitRate: 0.1
});

test.after(() => tmp.cleanup());

test('bob cannot see alice backtest run', () => {
  let thrown;
  try {
    backtestService.getRun(bob.id, aliceBacktest.id);
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown.status, 404);
});

test('bob cannot list alice backtest trades', () => {
  let thrown;
  try {
    backtestService.listTrades(bob.id, aliceBacktest.id);
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown.status, 404);
});
