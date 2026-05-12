import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const backtestService = await import('../src/services/backtestService.js');
const credentialService = await import('../src/services/kisCredentialService.js');

const alice = createUser(db, 'alice@example.com');
const bob = createUser(db, 'bob@example.com');

test.after(() => tmp.cleanup());

function dailyResponse(rows) {
  return {
    rt_cd: '0',
    output2: rows.map((row) => ({
      xymd: row.date.replaceAll('-', ''),
      open: String(row.close),
      high: String(row.close),
      low: String(row.close),
      clos: String(row.close),
      tvol: '1000'
    }))
  };
}

function withMockedFetch(rows, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'kis-token', expires_in: 3600 }) };
    }
    if (text.includes('/uapi/overseas-price/v1/quotations/dailyprice')) {
      return { ok: true, status: 200, json: async () => dailyResponse(rows) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

test('backtest fails clearly when KIS credentials are missing', async () => {
  let thrown;
  try {
    await backtestService.createRun(alice.id, {
      symbol: 'TQQQ',
      fromDate: '2025-01-01',
      toDate: '2025-01-31',
      totalBudget: 10000,
      splitCount: 10,
      targetProfitRate: 0.1
    });
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown.status, 400);
  assert.match(thrown.message, /KIS API 설정/);
});

test('backtest fetches KIS daily closes and produces USD summary', async () => {
  credentialService.saveSettings(alice.id, { appKey: 'app-good', appSecret: 'sec-good' });
  const run = await withMockedFetch([
    { date: '2025-01-02', close: 50 },
    { date: '2025-01-03', close: 49 },
    { date: '2025-01-06', close: 56 },
    { date: '2025-01-07', close: 60 }
  ], () => backtestService.createRun(alice.id, {
    symbol: 'TQQQ',
    fromDate: '2025-01-01',
    toDate: '2025-01-31',
    totalBudget: 10000,
    splitCount: 10,
    targetProfitRate: 0.1,
    restartAfterSell: false
  }));

  assert.equal(run.status, 'COMPLETED');
  assert.equal(run.symbol, 'TQQQ');
  assert.equal(run.market, 'US');
  assert.equal(run.currency, 'USD');
  assert.equal(run.dataSource, 'KIS_API');
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
