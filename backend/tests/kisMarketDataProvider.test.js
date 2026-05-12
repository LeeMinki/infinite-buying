import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const { KisMarketDataProvider } = await import('../src/market-data/KisMarketDataProvider.js');

const alice = createUser(db, 'alice-market@example.com');
credentialService.saveSettings(alice.id, { appKey: 'app-market', appSecret: 'sec-market' });

test.after(() => tmp.cleanup());

function withMockedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

test('KIS provider normalizes US current price response', async () => {
  await withMockedFetch(async (url) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok-market', expires_in: 3600 }) };
    }
    assert.ok(text.includes('/uapi/overseas-price/v1/quotations/price'));
    assert.ok(text.includes('SYMB=TQQQ'));
    return { ok: true, status: 200, json: async () => ({ rt_cd: '0', output: { last: '71.25' } }) };
  }, async () => {
    const provider = new KisMarketDataProvider(alice.id);
    const price = await provider.getCurrentPrice('tqqq');
    assert.equal(price.symbol, 'TQQQ');
    assert.equal(price.name, 'TQQQ');
    assert.equal(price.market, 'US');
    assert.equal(price.exchange, 'NAS');
    assert.equal(price.price, 71.25);
    assert.equal(price.currency, 'USD');
    assert.equal(price.source, 'KIS_API');
    assert.ok(Date.parse(price.fetchedAt));
  });
});

test('KIS provider normalizes daily candle response', async () => {
  await withMockedFetch(async (url) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok-market-2', expires_in: 3600 }) };
    }
    assert.ok(text.includes('/uapi/overseas-price/v1/quotations/dailyprice'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        rt_cd: '0',
        output2: [
          { xymd: '20260102', open: '50.1', high: '52.2', low: '49.8', clos: '51.5', tvol: '12345' }
        ]
      })
    };
  }, async () => {
    const provider = new KisMarketDataProvider(alice.id);
    const rows = await provider.getDailyPrices('TQQQ', { to: '2026-01-02' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].symbol, 'TQQQ');
    assert.equal(rows[0].market, 'US');
    assert.equal(rows[0].currency, 'USD');
    assert.equal(rows[0].source, 'KIS_API');
    assert.equal(rows[0].date, '2026-01-02');
    assert.equal(rows[0].close, 51.5);
  });
});

test('KIS provider normalizes KR current price response', async () => {
  await withMockedFetch(async (url) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok-market-3', expires_in: 3600 }) };
    }
    assert.ok(text.includes('/uapi/domestic-stock/v1/quotations/inquire-price'));
    assert.ok(text.includes('FID_INPUT_ISCD=005930'));
    return { ok: true, status: 200, json: async () => ({ rt_cd: '0', output: { stck_prpr: '70000', hts_kor_isnm: '삼성전자' } }) };
  }, async () => {
    const provider = new KisMarketDataProvider(alice.id);
    const price = await provider.getCurrentPrice('005930');
    assert.equal(price.symbol, '005930');
    assert.equal(price.name, '삼성전자');
    assert.equal(price.market, 'KR');
    assert.equal(price.exchange, 'KRX');
    assert.equal(price.price, 70000);
    assert.equal(price.currency, 'KRW');
  });
});

test('KIS provider searches overseas product info including fractional flags', async () => {
  await withMockedFetch(async (url) => {
    const text = String(url);
    if (text.endsWith('/oauth2/tokenP')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok-market-4', expires_in: 3600 }) };
    }
    assert.ok(text.includes('/uapi/overseas-price/v1/quotations/search-info'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        rt_cd: '0',
        output: {
          prdt_eng_name: 'PROSHARES ULTRAPRO QQQ',
          tr_crcy_cd: 'USD',
          ovrs_excg_cd: 'NASD',
          ovrs_excg_name: '나스닥',
          mint_dcpt_trad_psbl_yn: 'Y',
          buy_unit_qty: '1',
          sll_unit_qty: '1'
        }
      })
    };
  }, async () => {
    const provider = new KisMarketDataProvider(alice.id);
    const items = await provider.searchSymbols('TQQQ');
    assert.ok(items.some((item) => item.symbol === 'TQQQ' && item.currency === 'USD'));
    assert.ok(items.some((item) => item.fractionalTradingAvailable === true));
  });
});
