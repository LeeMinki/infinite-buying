import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();

const credentialService = await import('../src/services/kiwoomCredentialService.js');
const marketDataService = await import('../src/services/marketDataService.js');
const backtestService = await import('../src/services/backtestService.js');

const alice = createUser(db, 'alice-e2e@example.com');

test.after(() => tmp.cleanup());

function ka10081Response(rows) {
  return {
    return_code: 0,
    return_msg: '정상적으로 처리되었습니다',
    stk_cd: '005930',
    stk_dt_pole_chart_qry: rows.map((r) => ({
      dt: r.date.replaceAll('-', ''),
      open_pric: String(r.open),
      high_pric: String(r.high),
      low_pric: String(r.low),
      cur_prc: `+${r.close}`,
      trde_qty: '1234567'
    }))
  };
}

function withMockedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

test('full FE flow: fetch via Kiwoom → cache → backtest produces BUYs for Samsung at ~76k', async () => {
  credentialService.saveSettings(alice.id, { appKey: 'app-good', secretKey: 'sec-good' });

  const samsungDays = [];
  const start = new Date('2026-01-02T00:00:00Z');
  for (let i = 0; i < 90; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const close = 70000 + ((i * 137) % 12000);
    samsungDays.push({
      date: d.toISOString().slice(0, 10),
      open: close - 200, high: close + 500, low: close - 500, close
    });
  }
  const samsungDaysDesc = [...samsungDays].reverse();

  await withMockedFetch(async (url, init) => {
    if (url.endsWith('/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ token: 'tok-x', expires_in: 3600 }) };
    }
    const apiId = init.headers['api-id'];
    if (apiId === 'ka10081') {
      return { ok: true, status: 200, json: async () => ka10081Response(samsungDaysDesc) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }, async () => {
    const fetched = await marketDataService.getDailyPrices(alice.id, '005930', {
      from: '2026-01-01',
      to: '2026-04-30',
      requireReal: true
    });
    assert.ok(fetched.length > 0, 'fetched rows must be non-empty');
    assert.equal(fetched[0].source, 'KIWOOM');
    assert.ok(fetched[0].close > 60000 && fetched[0].close < 90000, `close in won range, got ${fetched[0].close}`);
  });

  const run = backtestService.createRun(alice.id, {
    stockCode: '005930',
    stockName: '삼성전자',
    fromDate: '2026-01-01',
    toDate: '2026-04-30',
    totalBudget: 4000000,
    splitCount: 40,
    targetProfitRate: 0.1,
    restartAfterSell: false
  });

  assert.equal(run.status, 'COMPLETED', `expected COMPLETED, got ${run.status} (${run.errorMessage || ''})`);
  assert.ok(run.totalBuyCount > 0, `expected at least one BUY, got ${run.totalBuyCount}`);
});
