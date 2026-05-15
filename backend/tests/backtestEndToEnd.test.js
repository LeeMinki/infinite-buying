import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();

const credentialService = await import('../src/services/kisCredentialService.js');
const marketDataService = await import('../src/services/marketDataService.js');
const backtestService = await import('../src/services/backtestService.js');

const alice = createUser(db, 'alice-e2e@example.com');

test.after(() => tmp.cleanup());

function kisDailyResponse(rows) {
  return {
    rt_cd: '0',
    output2: rows.map((r) => ({
      xymd: r.date.replaceAll('-', ''),
      open: String(r.open),
      high: String(r.high),
      low: String(r.low),
      clos: String(r.close),
      tvol: '1234567'
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

test('full flow: fetch TQQQ KIS daily data, cache it, and run a USD backtest', async () => {
  credentialService.saveSettings(alice.id, { appKey: 'app-good', appSecret: 'sec-good' });

  const days = [];
  const start = new Date('2026-01-02T00:00:00Z');
  for (let i = 0; i < 90; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const close = 50 + ((i * 7) % 28);
    days.push({
      date: d.toISOString().slice(0, 10),
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close
    });
  }

  await withMockedFetch(async (url) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok-x', expires_in: 3600 }) };
    }
    if (text.includes('/uapi/overseas-price/v1/quotations/dailyprice')) {
      return { ok: true, status: 200, json: async () => kisDailyResponse(days) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }, async () => {
    const fetched = await marketDataService.getDailyPrices(alice.id, 'TQQQ', {
      from: '2026-01-01',
      to: '2026-04-30',
      refresh: true
    });
    assert.ok(fetched.length > 0, 'fetched rows must be non-empty');
    assert.equal(fetched[0].source, 'KIS_API');
    assert.equal(fetched[0].currency, 'USD');

    const run = await backtestService.createRun(alice.id, {
      symbol: 'TQQQ',
      fromDate: '2026-01-01',
      toDate: '2026-04-30',
      totalBudget: 10000,
      splitCount: 40,
      targetProfitRate: 0.1,
      restartAfterSell: false
    });

    assert.equal(run.status, 'COMPLETED', `expected COMPLETED, got ${run.status} (${run.errorMessage || ''})`);
    assert.equal(run.currency, 'USD');
    assert.ok(run.totalBuyCount > 0, `expected at least one BUY, got ${run.totalBuyCount}`);
    // 기본 모드는 1주 단위 매수.
    assert.equal(run.allowFractionalShares, false);
    assert.ok(Number.isInteger(run.finalHoldingQuantity), `1주 단위 모드의 최종 보유 수량은 정수여야 함: ${run.finalHoldingQuantity}`);

    // 소수점 매매 옵션을 켜면 소수점 수량 시뮬레이션.
    const fractionalRun = await backtestService.createRun(alice.id, {
      symbol: 'TQQQ',
      fromDate: '2026-01-01',
      toDate: '2026-04-30',
      totalBudget: 10000,
      splitCount: 40,
      targetProfitRate: 0.1,
      restartAfterSell: false,
      allowFractionalShares: true
    });
    assert.equal(fractionalRun.status, 'COMPLETED');
    assert.equal(fractionalRun.allowFractionalShares, true);
  });
});
