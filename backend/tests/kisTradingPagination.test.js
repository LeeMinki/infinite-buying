import assert from 'node:assert/strict';
import test from 'node:test';
import { KisTradingService, domesticHistoryWindows } from '../src/services/kisTradingService.js';

// 공식 로컬 엑셀(20260512): 잔고·주문체결·정정취소가능조회 F/M → N,
// 해외 미체결 TTTS3018R만 tr_cont 없이 FK200/NK200을 넘긴다.
let sequence = 0;
function makeContext() {
  return {
    baseUrl: 'https://example.invalid', appKey: `pagination-${++sequence}`,
    appSecret: 'fake-secret', accessToken: 'fake-token',
    accountNumber: 'fake-account', accountProductCode: '01'
  };
}

async function mockFetch(handler, work) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await work(); } finally { globalThis.fetch = original; }
}

function response(data, continuation = '') {
  return { ok: true, status: 200, headers: new Headers({ tr_cont: continuation }), json: async () => ({
    ctx_area_fk100: '', ctx_area_nk100: '', ctx_area_fk200: '', ctx_area_nk200: '', ...data
  }) };
}

test('국내/해외 잔고는 마지막 페이지까지 확인한 뒤 해당 종목 보유량을 반환한다', async () => {
  for (const market of ['KR', 'US']) {
    const context = makeContext();
    const trading = new KisTradingService(sequence);
    const suffix = market === 'KR' ? '100' : '200';
    let calls = 0;
    await mockFetch(async (url, init) => {
      const query = new URL(url).searchParams;
      calls += 1;
      if (calls === 1) {
        assert.equal(init.headers.tr_cont, undefined);
        return response({
          rt_cd: '0', output1: [], output2: { dnca_tot_amt: '5000', frcr_buy_psbl_amt1: '5000' },
          [`ctx_area_fk${suffix}`]: ' search ', [`ctx_area_nk${suffix}`]: ' next '
        }, 'F');
      }
      assert.equal(init.headers.tr_cont, 'N');
      assert.equal(query.get(`CTX_AREA_FK${suffix}`), ' search ');
      assert.equal(query.get(`CTX_AREA_NK${suffix}`), ' next ');
      return response({ rt_cd: '0', output1: [market === 'KR'
        ? { pdno: '005930', hldg_qty: '7', pchs_avg_pric: '100' }
        : { ovrs_pdno: 'SAMPLE', ovrs_cblc_qty: '7', pchs_avg_pric: '100' }] }, 'E');
    }, async () => {
      const balance = market === 'KR'
        ? await trading.getDomesticBalance(context, '005930')
        : await trading.getOverseasBalance(context, 'SAMPLE');
      assert.equal(balance.quantity, 7);
      assert.equal(balance.cashAvailable, 5000);
      assert.equal(calls, 2);
    });
  }
});

test('종목·수량이 불명확한 잔고 행은 대상 종목이 아니어도 빈 보유로 확정하지 않는다', async () => {
  for (const market of ['KR', 'US']) {
    const symbolKey = market === 'KR' ? 'pdno' : 'ovrs_pdno';
    const quantityKey = market === 'KR' ? 'hldg_qty' : 'ovrs_cblc_qty';
    for (const badRow of [
      null, { [quantityKey]: '0' }, { [symbolKey]: 'OTHER' },
      ...['bad', '-1', 'Infinity', '', false].map((quantity) => ({ [symbolKey]: 'OTHER', [quantityKey]: quantity }))
    ]) {
      const context = makeContext();
      await mockFetch(async () => response({ rt_cd: '0', output1: [badRow] }, 'D'), async () => {
        const trading = new KisTradingService(sequence);
        await assert.rejects(market === 'KR'
          ? trading.getDomesticBalance(context, '005930')
          : trading.getOverseasBalance(context, 'SAMPLE'), /종목 또는 수량/);
      });
    }
  }
});

test('성공 코드가 빠진 빈 잔고 응답은 보유량 0으로 인정하지 않는다', async () => {
  await mockFetch(async () => response({ output1: [] }, 'D'), async () => {
    await assert.rejects(new KisTradingService(1).getDomesticBalance(makeContext(), '005930'));
  });
});

test('같은 종목의 첫 행이 0주여도 나머지 잔고 행의 보유 수량과 손실을 보존한다', async () => {
  await mockFetch(async () => response({ rt_cd: '0', output1: [
    { pdno: '005930', hldg_qty: '0', pchs_avg_pric: '0', evlu_pfls_amt: '0' },
    { pdno: '005930', hldg_qty: '2', pchs_avg_pric: '100', evlu_pfls_amt: '-1', evlu_pfls_rt: '-0.5' }
  ] }, 'D'), async () => {
    const balance = await new KisTradingService(1).getDomesticBalance(makeContext(), '005930');
    assert.equal(balance.quantity, 2);
    assert.equal(balance.averagePrice, 100);
    assert.equal(balance.unrealizedProfit, -1);
    assert.equal(balance.unrealizedProfitRate, -0.005);
  });
});

test('공식 해외 잔고의 공백·0 placeholder만 제외하고 양수·불명 수량은 거절한다', async () => {
  const placeholder = {
    ovrs_pdno: '', ovrs_cblc_qty: '0', pchs_avg_pric: '0.0000',
    frcr_evlu_pfls_amt: '0.000000', evlu_pfls_rt: '0.00', ovrs_item_name: '', ovrs_excg_cd: ''
  };
  await mockFetch(async () => response({ rt_cd: '0', output1: [placeholder] }, 'E'), async () => {
    assert.equal((await new KisTradingService(1).getOverseasBalance(makeContext(), 'SAMPLE')).quantity, 0);
  });
  for (const invalid of [
    { ...placeholder, ovrs_cblc_qty: '1' }, { ...placeholder, ovrs_cblc_qty: 'bad' },
    { ...placeholder, ord_psbl_qty: '1' }
  ]) {
    await mockFetch(async () => response({ rt_cd: '0', output1: [invalid] }, 'E'), async () => {
      await assert.rejects(new KisTradingService(1).getOverseasBalance(makeContext(), 'SAMPLE'), /종목 또는 수량/);
    });
  }
});

test('공식 해외 조회없음 객체는 KIOK0560과 빈 identity·0수량·0금액 증거가 있을 때만 빈 목록이다', async () => {
  const empty = {
    odno: '', orgn_odno: '', pdno: '', ord_dt: '', ord_tmd: '',
    ft_ord_qty: '0', ft_ccld_qty: '0', nccs_qty: '0',
    ft_ord_unpr3: '0.00000000', ft_ccld_unpr3: '0.00000000', ft_ccld_amt3: '0.00000',
    mdia_dvsn_name: 'OpenAPI', usa_amk_exts_rqst_yn: 'N'
  };
  await mockFetch(async () => response({ rt_cd: '0', msg_cd: 'KIOK0560', output: empty }, 'D'), async () => {
    assert.deepEqual(await new KisTradingService(1).getOverseasOrderHistory(makeContext(), 'SAMPLE'), []);
  });
  await mockFetch(async () => response({ rt_cd: '0', msg_cd: 'KIOK0560', output: { ...empty, ft_ccld_qty: '1' } }, 'D'), async () => {
    await assert.rejects(new KisTradingService(1).getOverseasOrderHistory(makeContext(), 'SAMPLE'), /응답 목록/);
  });
});

test('국내 미체결·체결내역·손익과 해외 체결내역은 모든 페이지를 합친다', async () => {
  const cases = [
    { key: 'output', suffix: '100', call: (s, c) => s.getDomesticOpenOrders(c, '005930') },
    { key: 'output1', suffix: '100', call: (s, c) => s.getDomesticOrderHistory(c, '005930', { exchange: 'ALL' }), all: true },
    { key: 'output1', suffix: '100', call: (s, c) => s.getDomesticRealizedProfits(c) },
    { key: 'output', suffix: '200', call: (s, c) => s.getOverseasOrderHistory(c, '005930') }
  ];
  for (const item of cases) {
    const context = makeContext();
    let calls = 0;
    await mockFetch(async (url, init) => {
      const query = new URL(url).searchParams;
      if (item.all) assert.equal(query.get('EXCG_ID_DVSN_CD'), 'ALL');
      calls += 1;
      if (calls === 2) assert.equal(init.headers.tr_cont, 'N');
      return response({
        rt_cd: '0', [item.key]: [{ pdno: '005930', odno: `page-${calls}`, ord_qty: '1', rmn_qty: '1' }],
        [`ctx_area_fk${item.suffix}`]: 'search', [`ctx_area_nk${item.suffix}`]: calls === 1 ? 'next' : ''
      }, calls === 1 ? 'M' : 'D');
    }, async () => {
      const rows = await item.call(new KisTradingService(sequence), context);
      assert.equal(rows.length, 2);
      assert.equal(calls, 2);
      assert.equal(Array.isArray(rows), true);
    });
  }
});

test('해외 미체결은 tr_cont 없이 NK200 검색 키로 다음 페이지를 조회한다', async () => {
  const context = makeContext();
  let calls = 0;
  await mockFetch(async (url, init) => {
    calls += 1;
    assert.equal(init.headers.tr_cont, undefined);
    const query = new URL(url).searchParams;
    assert.equal(query.get('OVRS_EXCG_CD'), 'NASD');
    assert.equal(query.get('CTX_AREA_NK200'), calls === 1 ? '' : 'next');
    return response({
      rt_cd: '0', output: calls === 1 ? [] : [{ pdno: 'SAMPLE', odno: 'open', ft_ord_qty: '2', nccs_qty: '2' }],
      ctx_area_fk200: 'search', ctx_area_nk200: calls === 1 ? 'next' : '  '
    });
  }, async () => {
    const orders = await new KisTradingService(sequence).getOverseasOpenOrders(context, 'SAMPLE');
    assert.equal(calls, 2);
    assert.equal(orders[0].remainingQuantity, 2);
  });
});

test('마지막 페이지처럼 보이더라도 cursor 필드 누락·잘못된 타입은 완료로 인정하지 않는다', async () => {
  for (const [market, value] of [['KR', undefined], ['KR', 0], ['US', undefined], ['US', 0]]) {
    const context = makeContext();
    const suffix = market === 'KR' ? '100' : '200';
    await mockFetch(async () => response({ rt_cd: '0', output: [], [`ctx_area_nk${suffix}`]: value }), async () => {
      const trading = new KisTradingService(sequence);
      await assert.rejects(market === 'KR'
        ? trading.getDomesticOpenOrders(context, '005930')
        : trading.getOverseasOpenOrders(context, 'SAMPLE'), /검색 키 응답/);
    });
  }
});

test('연속조회 실패·반복 키·누락 키·잘못된 목록은 잔고 0이나 부분 주문 목록을 반환하지 않는다', async () => {
  for (const kind of ['failure', 'repeat', 'missing-key', 'missing-list', 'missing-header']) {
    const context = makeContext();
    let calls = 0;
    await mockFetch(async () => {
      calls += 1;
      if (kind === 'missing-list') return response({ rt_cd: '0' });
      if (kind === 'missing-key') return response({ rt_cd: '0', output: [] }, 'M');
      if (kind === 'failure' && calls === 2) {
        return response({ rt_cd: '1', msg_cd: 'APBK0001', msg1: '조회 거절' });
      }
      return response({ rt_cd: '0', output: [], ctx_area_fk100: 'search', ctx_area_nk100: 'same' }, kind === 'missing-header' ? '' : 'M');
    }, async () => {
      await assert.rejects(new KisTradingService(sequence).getDomesticOpenOrders(context, '005930'));
      assert.ok(calls <= 2);
    });
  }
});

test('100페이지가 넘어가면 완전 조회로 가장하지 않고 중단한다', async () => {
  const trading = new KisTradingService(1);
  let calls = 0;
  trading.requestJson = async () => ({ rt_cd: '0', output: [], ctx_area_fk200: 'search', ctx_area_nk200: String(++calls) });
  await assert.rejects(trading.requestAllPages('/pages', {
    query: { CTX_AREA_FK200: '', CTX_AREA_NK200: '' }
  }, { continuation: 'cursor' }), /페이지 한도/);
  assert.equal(calls, 100);
});

test('JSON 파싱 실패를 빈 성공 응답으로 바꾸지 않는다', async () => {
  await mockFetch(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad JSON'); } }), async () => {
    await assert.rejects(new KisTradingService(1).requestJsonOnce('/balance', {
      method: 'GET', trId: 'TEST', context: makeContext()
    }), (error) => error.status === 502);
  });
});

test('주문 POST의 EGW 응답은 자동 재시도하지 않고 UNKNOWN으로 남긴다', async () => {
  let calls = 0;
  await mockFetch(async () => {
    calls += 1;
    return response({ rt_cd: '1', msg_cd: 'EGW00201' });
  }, async () => {
    await assert.rejects(new KisTradingService(1).requestOrder('/order', {
      trId: 'TEST', context: makeContext(), body: { ORD_QTY: '1' }, order: {}
    }), (error) => error.orderOutcome === 'UNKNOWN');
    assert.equal(calls, 1);
  });
});

test('국내 주문 이력은 KST 최근 3개월 경계를 겹침 없이 나누고 월말을 보정한다', () => {
  assert.deepEqual(domesticHistoryWindows({ startDate: '2026-05-01', endDate: '2026-09-07' }, new Date('2026-09-07T00:00:00Z')), [
    { trId: 'CTSC9215R', startDate: '20260501', endDate: '20260606' },
    { trId: 'TTTC0081R', startDate: '20260607', endDate: '20260907' }
  ]);
  assert.deepEqual(domesticHistoryWindows({ startDate: '2026-02-28' }, new Date('2026-05-31T00:00:00Z')), [
    { trId: 'TTTC0081R', startDate: '20260228', endDate: '20260228' }
  ]);
  assert.throws(() => domesticHistoryWindows({ startDate: '2026-02-30' }), /날짜/);
  assert.throws(() => domesticHistoryWindows({ startDate: '2026-03-01', endDate: '2026-02-01' }), /시작일/);
});

test('국내 과거 체결은 CTSC9215R와 전체 거래소를 사용하고 대사 필드를 보존한다', async () => {
  const context = makeContext();
  await mockFetch(async (url, init) => {
    assert.equal(init.headers.tr_id, 'CTSC9215R');
    assert.equal(new URL(url).searchParams.get('EXCG_ID_DVSN_CD'), 'ALL');
    return response({ rt_cd: '0', output1: [{
      pdno: '005930', odno: 'history', ord_qty: '3', ord_unpr: '70000',
      ord_dt: '20200102', ord_tmd: '091010', excg_id_dvsn_Cd: 'KRX', rjct_qty: '3'
    }] }, 'D');
  }, async () => {
    const [order] = await new KisTradingService(sequence).getDomesticOrderHistory(context, '005930', {
      startDate: '2020-01-02', exchange: 'ALL'
    });
    assert.equal(order.status, 'REJECTED');
    assert.equal(order.orderedQuantity, 3);
    assert.equal(order.orderPrice, 70000);
    assert.equal(order.orderDate, '20200102');
    assert.equal(order.orderTime, '091010');
    assert.equal(order.exchange, 'KRX');
  });
});
