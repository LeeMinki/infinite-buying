import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();

const marketDataService = await import('../src/services/marketDataService.js');
const marketCache = await import('../src/repositories/marketPriceCacheRepository.js');

const alice = createUser(db, 'alice-cache@example.com');

test.after(() => tmp.cleanup());

function seedRows(userId, stockCode, dates) {
  marketCache.upsertDailyPrices(userId, dates.map((date, idx) => ({
    stockCode,
    date,
    open: 50000 + idx,
    high: 50000 + idx,
    low: 50000 + idx,
    close: 50000 + idx,
    volume: 1000,
    source: 'KIWOOM'
  })));
}

// Without saved kiwoom credentials, createMarketDataProvider throws synchronously
// inside the service. We use that as a probe: if cache is consulted first
// and covers the requested range, no provider call is attempted, no error is thrown.

test('cache-first: returns cached rows without calling provider when cache covers the range', async () => {
  seedRows(alice.id, '111111', ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07']);
  const rows = await marketDataService.getDailyPrices(alice.id, '111111', {
    from: '2025-01-01',
    to: '2025-01-08',
    requireReal: true
  });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.source === 'KIWOOM'));
});

test('falls back to provider when cache does not cover the range', async () => {
  seedRows(alice.id, '222222', ['2025-01-02']);
  let thrown;
  try {
    await marketDataService.getDailyPrices(alice.id, '222222', {
      from: '2025-01-01',
      to: '2025-12-31',
      requireReal: true
    });
  } catch (e) {
    thrown = e;
  }
  // Cache had rows but failed coverage check -> provider was called
  // and falls back to partial cache because kiwoom credentials are missing.
  assert.ok(thrown === undefined, '캐시가 부분만 있을 때 provider 실패 시 cache fallback 으로 응답해야 함');
});

test('throws when neither cache covers nor provider is configured', async () => {
  let thrown;
  try {
    await marketDataService.getDailyPrices(alice.id, '999999', {
      from: '2025-01-01',
      to: '2025-12-31',
      requireReal: true
    });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, 'no cache + no provider must throw');
  assert.match(thrown.message, /키움/);
});

test('refresh=true triggers provider call even when cache covers the range', async () => {
  seedRows(alice.id, '333333', ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07']);
  let thrown;
  try {
    await marketDataService.getDailyPrices(alice.id, '333333', {
      from: '2025-01-01',
      to: '2025-01-08',
      requireReal: true,
      refresh: true
    });
  } catch (e) {
    thrown = e;
  }
  // refresh=true bypasses cache fallback when provider fails
  assert.ok(thrown, 'refresh=true 일 때 provider 실패는 throw 되어야 함');
});
