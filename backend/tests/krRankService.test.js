import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const credentialService = await import('../src/services/kisCredentialService.js');
const service = await import('../src/services/krRankService.js');
const repo = await import('../src/repositories/krRankRepository.js');

const user = createUser(db, 'kr-rank-service@example.com');
credentialService.saveSettings(user.id, {
  appKey: 'app-kr-rank',
  appSecret: 'secret-kr-rank',
  accountNumber: '12345678',
  accountProductCode: '01'
});

test.after(() => tmp.cleanup());

function withMockedDate(iso, run) {
  const RealDate = globalThis.Date;
  const fixed = new RealDate(iso);
  class FakeDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed.getTime();
    }
    static parse(value) {
      return RealDate.parse(value);
    }
    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  }
  globalThis.Date = FakeDate;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.Date = RealDate;
    });
}

function withMockedFetch(state, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const text = String(url);
    const parsed = new URL(text);
    if (text.endsWith('/oauth2/tokenP')) {
      return json({ rt_cd: '0', access_token: 'tok-kr-rank', expires_in: 3600 });
    }
    if (text.includes('/uapi/domestic-stock/v1/ranking/fluctuation')) {
      return json({
        rt_cd: '0',
        output: state.rankingRows || [
          { stck_shrn_iscd: '018260', hts_kor_isnm: '삼성에스디에스', stck_prpr: '286500', prdy_ctrt: '15.0' },
          { stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_prpr: '70000', prdy_ctrt: '10.0' }
        ]
      });
    }
    if (text.includes('/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice')) {
      return json({ rt_cd: '0', output2: passingMinuteCandles() });
    }
    if (text.includes('/uapi/domestic-stock/v1/quotations/inquire-price')) {
      const symbol = parsed.searchParams.get('FID_INPUT_ISCD');
      const price = state.prices?.[symbol] ?? 70_000;
      return json({
        rt_cd: '0',
        output: {
          stck_prpr: String(price),
          stck_mxpr: String(price),
          hts_kor_isnm: symbol
        }
      });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-psbl-order')) {
      return json({ rt_cd: '0', output: { nrcvb_buy_amt: String(state.cash ?? 158_105), nrcvb_buy_qty: '999' } });
    }
    if (text.includes('/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl')) {
      return json({ rt_cd: '0', output: [] });
    }
    if (options.method === 'POST' && text.includes('/uapi/domestic-stock/v1/trading/order-cash')) {
      state.orderCalls = (state.orderCalls || 0) + 1;
      return json({ rt_cd: '0', output: { ODNO: `KRO${state.orderCalls}` } });
    }
    return json({ rt_cd: '0', output: {} });
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function passingMinuteCandles() {
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    const close = 100 + i;
    out.push({
      stck_cntg_hour: String(91000 + i * 100).padStart(6, '0'),
      stck_oprc: String(close - 1),
      stck_hgpr: String(close + 1),
      stck_lwpr: String(close - 2),
      stck_prpr: String(close),
      cntg_vol: '100000'
    });
  }
  return out.reverse();
}

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('한국 랭킹은 매수가능금액으로 1주도 못 사는 후보를 건너뛰고 다음 후보를 산다', async () => {
  await withMockedFetch({
    cash: 158_105,
    prices: { '018260': 286_500, '005930': 70_000 }
  }, async () => {
    const strategy = service.createStrategy(user.id, {
      autoBudgetEnabled: true,
      morningBudget: 0,
      morningTargetProfitRate: 0.02,
      morningStopLossRate: 0.05,
      lunchEntryEnabled: false,
      lunchBudget: 0,
      lunchTargetProfitRate: 0.02,
      lunchStopLossRate: 0.05
    });
    await service.startStrategy(user.id, strategy.id);
    await withMockedDate('2026-05-29T00:10:00Z', async () => {
      const result = await service.evaluateStrategy(user.id, strategy.id);
      assert.equal(result.decision.decision, 'BUY');
      assert.equal(result.decision.selectedSymbol, '005930');
      assert.equal(result.decision.expectedQuantity, 2);
      assert.equal(result.order.symbol, '005930');
      const target = repo.listOrders(user.id, { strategyId: strategy.id })
        .find((order) => order.side === 'SELL' && order.sellReason === 'TARGET');
      assert.equal(target.status, 'DECIDED');
      assert.equal(target.liveOrderEnabled, false);
    });
  });
});
