import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb } from './_helpers/dbHarness.js';

// 순수 함수 테스트지만, 서비스 모듈 import 체인이 dev DB를 건드리지 않도록 임시 DB로 격리한다.
const tmp = useTempDb();
await bootstrapDb();
const { buildLaorRealizedRecords, summarizeByCurrency } = await import('../src/services/autoTradingService.js');

test.after(() => tmp.cleanup());

function order(o) {
  return { market: 'KR', currency: 'KRW', symbol: 'X', ...o };
}

test('기간 수익률: 실현 기록은 이득/손실/이동평균/통화분리를 정확히 계산한다', () => {
  const orders = [
    // A) 이득 (KRW): 10주 100 매수 → 120 매도 = +200, 원가 1000
    order({ id: 1, strategyId: 1, side: 'BUY', status: 'ACCEPTED', quantity: 10, orderPrice: 100, createdAt: '2026-05-01 10:00:00' }),
    order({ id: 2, strategyId: 1, side: 'SELL', status: 'ACCEPTED', quantity: 10, orderPrice: 120, createdAt: '2026-05-01 11:00:00' }),
    // B) 손실 (USD): 5주 50 매수 → 40 매도 = -50, 원가 250
    order({ id: 3, strategyId: 2, currency: 'USD', symbol: 'TQQQ', market: 'US', side: 'BUY', status: 'ACCEPTED', quantity: 5, orderPrice: 50, createdAt: '2026-05-02 10:00:00' }),
    order({ id: 4, strategyId: 2, currency: 'USD', symbol: 'TQQQ', market: 'US', side: 'SELL', status: 'ACCEPTED', quantity: 5, orderPrice: 40, createdAt: '2026-05-02 11:00:00' }),
    // F) 이동평균 (KRW): 10@100, 10@200 → 평단 150, 10주 180 매도 = +300, 원가 1500
    order({ id: 7, strategyId: 6, side: 'BUY', status: 'ACCEPTED', quantity: 10, orderPrice: 100, createdAt: '2026-05-03 10:00:00' }),
    order({ id: 8, strategyId: 6, side: 'BUY', status: 'ACCEPTED', quantity: 10, orderPrice: 200, createdAt: '2026-05-03 10:30:00' }),
    order({ id: 9, strategyId: 6, side: 'SELL', status: 'ACCEPTED', quantity: 10, orderPrice: 180, createdAt: '2026-05-03 11:00:00' })
  ];

  const records = buildLaorRealizedRecords(orders);
  assert.equal(records.length, 3);

  const krw = records.filter((r) => r.currency === 'KRW');
  const usd = records.filter((r) => r.currency === 'USD');
  assert.deepEqual(krw.map((r) => r.profitAmount).sort((a, b) => a - b), [200, 300]);
  assert.equal(usd[0].profitAmount, -50);
  assert.equal(usd[0].baseAmount, 250);

  const byCurrency = summarizeByCurrency(records);
  // 통화별로 분리 합산되어야 한다 (KRW/USD를 한 값으로 섞지 않음)
  assert.equal(byCurrency.KRW.profitAmount, 500);
  assert.equal(byCurrency.KRW.baseAmount, 2500);
  assert.ok(Math.abs(byCurrency.KRW.returnRate - 0.2) < 1e-9);
  assert.equal(byCurrency.KRW.tradeCount, 2);
  assert.equal(byCurrency.USD.profitAmount, -50);
  assert.ok(Math.abs(byCurrency.USD.returnRate + 0.2) < 1e-9);
});

test('기간 수익률: DRY_RUN(모의)·FAILED·매수없는 매도는 손익에서 제외한다', () => {
  const orders = [
    // DRY_RUN: 실주문 OFF 모의 → 제외
    order({ id: 10, strategyId: 3, side: 'BUY', status: 'DRY_RUN', quantity: 10, orderPrice: 100, createdAt: '2026-05-04 10:00:00' }),
    order({ id: 11, strategyId: 3, side: 'SELL', status: 'DRY_RUN', quantity: 10, orderPrice: 200, createdAt: '2026-05-04 11:00:00' }),
    // FAILED 매도 → 제외 (매수만 있고 실현 없음)
    order({ id: 12, strategyId: 4, side: 'BUY', status: 'ACCEPTED', quantity: 10, orderPrice: 100, createdAt: '2026-05-05 10:00:00' }),
    order({ id: 13, strategyId: 4, side: 'SELL', status: 'FAILED', quantity: 10, orderPrice: 200, createdAt: '2026-05-05 11:00:00' }),
    // 매수 없이 들어온 매도 → 포지션 없음, 건너뜀
    order({ id: 14, strategyId: 5, side: 'SELL', status: 'ACCEPTED', quantity: 10, orderPrice: 100, createdAt: '2026-05-06 10:00:00' })
  ];

  const records = buildLaorRealizedRecords(orders);
  assert.equal(records.length, 0);
  assert.deepEqual(summarizeByCurrency(records), {});
});

test('기간 수익률: 기록이 없으면 빈 집계를 돌려준다', () => {
  assert.deepEqual(summarizeByCurrency([]), {});
  assert.deepEqual(buildLaorRealizedRecords([]), []);
  assert.deepEqual(buildLaorRealizedRecords(null), []);
});
