import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();

const marketDataService = await import('../src/services/marketDataService.js');
const marketCache = await import('../src/repositories/marketPriceCacheRepository.js');

const alice = createUser(db, 'alice-cache@example.com');

test.after(() => tmp.cleanup());

function seedRows(userId, symbol, dates) {
  marketCache.upsertDailyPrices(userId, dates.map((date, idx) => ({
    symbol,
    market: 'US',
    date,
    open: 50 + idx,
    high: 50 + idx,
    low: 50 + idx,
    close: 50 + idx,
    volume: 1000,
    currency: 'USD',
    source: 'KIS_API'
  })));
}

test('cache-first: returns cached KIS rows without calling provider when cache covers the range', async () => {
  seedRows(alice.id, 'TQQQ', ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07']);
  const rows = await marketDataService.getDailyPrices(alice.id, 'tqqq', {
    from: '2025-01-01',
    to: '2025-01-08'
  });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.source === 'KIS_API'));
  assert.ok(rows.every((row) => row.symbol === 'TQQQ'));
});

test('throws when neither cache covers nor KIS credential is configured', async () => {
  let thrown;
  try {
    await marketDataService.getDailyPrices(alice.id, 'QQQ', {
      from: '2025-01-01',
      to: '2025-12-31',
      refresh: true
    });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, 'no cache + no provider must throw');
  assert.match(thrown.message, /KIS API 설정/);
});
