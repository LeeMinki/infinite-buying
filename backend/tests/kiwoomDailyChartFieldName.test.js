import assert from 'node:assert/strict';
import test from 'node:test';
import { KiwoomMarketDataProvider } from '../src/market-data/KiwoomMarketDataProvider.js';

function withMockedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload
  };
}

test('getDailyPrices reads candles from stk_dt_pole_chart_qry (ka10081 actual field)', async () => {
  const provider = new KiwoomMarketDataProvider({
    baseUrl: 'https://example.test',
    timeoutMs: 5000,
    tokenSupplier: async () => 'tok'
  });
  await withMockedFetch(async () => jsonResponse({
    return_code: 0,
    return_msg: '정상적으로 처리되었습니다',
    stk_cd: '005930',
    stk_dt_pole_chart_qry: [
      { dt: '20260507', open_pric: '70000', high_pric: '71000', low_pric: '69500', cur_prc: '70500', trde_qty: '12345' },
      { dt: '20260506', open_pric: '69500', high_pric: '70200', low_pric: '69000', cur_prc: '70000', trde_qty: '11000' }
    ]
  }), async () => {
    const rows = await provider.getDailyPrices('005930', { from: '2026-05-01', to: '2026-05-07' });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].date, '2026-05-07');
    assert.equal(rows[0].close, 70500);
    assert.equal(rows[0].source, 'KIWOOM');
  });
});

test('getDailyPrices includes return_msg when response body has no candles', async () => {
  const provider = new KiwoomMarketDataProvider({
    baseUrl: 'https://example.test',
    timeoutMs: 5000,
    tokenSupplier: async () => 'tok'
  });
  await withMockedFetch(async () => jsonResponse({
    return_code: 0,
    return_msg: '조회된 데이터가 없습니다',
    stk_cd: '005930',
    stk_dt_pole_chart_qry: []
  }), async () => {
    await assert.rejects(
      () => provider.getDailyPrices('005930', { to: '2026-05-07' }),
      /Kiwoom daily price response was empty.*조회된 데이터가 없습니다/
    );
  });
});
