import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const backtestService = await import('../src/services/backtestService.js');
const credentialService = await import('../src/services/kisCredentialService.js');

const alice = createUser(db, 'alice@example.com');
const bob = createUser(db, 'bob@example.com');
credentialService.saveSettings(alice.id, { appKey: 'app-isolation', appSecret: 'sec-isolation' });

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const text = String(url);
  if (text.endsWith('/oauth2/tokenP')) {
    return { ok: true, status: 200, json: async () => ({ access_token: 'tok-isolation', expires_in: 3600 }) };
  }
  if (text.includes('/uapi/overseas-price/v1/quotations/dailyprice')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        rt_cd: '0',
        output2: [
          { xymd: '20250102', open: '50', high: '50', low: '50', clos: '50', tvol: '100' },
          { xymd: '20250103', open: '56', high: '56', low: '56', clos: '56', tvol: '100' }
        ]
      })
    };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const aliceBacktest = await backtestService.createRun(alice.id, {
  symbol: 'TQQQ',
  fromDate: '2025-01-01',
  toDate: '2025-01-31',
  totalBudget: 10000,
  splitCount: 10,
  targetProfitRate: 0.1
});

test.after(() => {
  globalThis.fetch = originalFetch;
  tmp.cleanup();
});

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
