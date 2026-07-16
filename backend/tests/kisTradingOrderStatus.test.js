import assert from 'node:assert/strict';
import test from 'node:test';
import { KisTradingService, findOrderHistoryMatch, normalizeOrderRow } from '../src/services/kisTradingService.js';
import { env } from '../src/config/env.js';

// 로컬 KIS 문서 기준:
// - 국내: 주식일별주문체결조회(TTTC0081R)
// - 해외: 해외주식 주문체결내역(TTTS3035R)

test('국내 주문은 실제 총체결수량이 있을 때만 FILLED로 판정한다', () => {
  const order = normalizeOrderRow({
    odno: 'KR-FILLED-1',
    pdno: '005930',
    sll_buy_dvsn_cd: '02',
    ord_qty: '10',
    tot_ccld_qty: '10',
    rmn_qty: '0',
    avg_prvs: '70000'
  }, 'KR', 'KRW');

  assert.equal(order.status, 'FILLED');
  assert.equal(order.filledQuantity, 10);
  assert.equal(order.remainingQuantity, 0);
});

test('국내 미체결·부분체결 주문은 잔여수량 기준으로 열린 상태를 구분한다', () => {
  const accepted = normalizeOrderRow({
    odno: 'KR-OPEN-1', ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '10'
  }, 'KR', 'KRW');
  const partial = normalizeOrderRow({
    odno: 'KR-PARTIAL-1', ord_qty: '10', tot_ccld_qty: '4', rmn_qty: '6', avg_prvs: '69900'
  }, 'KR', 'KRW');

  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(partial.status, 'PARTIALLY_FILLED');
  assert.equal(partial.filledQuantity, 4);
  assert.equal(partial.remainingQuantity, 6);
});

test('국내 거부 주문은 주문수량이 있어도 FILLED가 아니라 REJECTED다', () => {
  // KIS 문서 응답 예시와 같은 형태: ord_qty=10, 체결=0, 잔량=0, rjct_qty=10.
  const order = normalizeOrderRow({
    odno: 'KR-REJECTED-1',
    pdno: '009150',
    sll_buy_dvsn_cd: '02',
    sll_buy_dvsn_cd_name: 'BUY REJECT',
    ord_qty: '10',
    tot_ccld_qty: '0',
    rmn_qty: '0',
    rjct_qty: '10',
    avg_prvs: '0'
  }, 'KR', 'KRW');

  assert.equal(order.status, 'REJECTED');
  assert.equal(order.filledQuantity, 0);
});

test('국내 취소와 일부체결 후 잔량 취소는 CANCELED이며 실제 체결수량은 보존한다', () => {
  const canceled = normalizeOrderRow({
    odno: 'KR-CANCELED-1', ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '0',
    cncl_yn: 'Y', cncl_cfrm_qty: '10'
  }, 'KR', 'KRW');
  const partialThenCanceled = normalizeOrderRow({
    odno: 'KR-CANCELED-2', ord_qty: '10', tot_ccld_qty: '4', rmn_qty: '0',
    cncl_yn: 'Y', cnc_cfrm_qty: '6', avg_prvs: '69800'
  }, 'KR', 'KRW');

  assert.equal(canceled.status, 'CANCELED');
  assert.equal(partialThenCanceled.status, 'CANCELED');
  assert.equal(partialThenCanceled.filledQuantity, 4);
  assert.equal(partialThenCanceled.averageFilledPrice, 69800);
});

test('해외 주문은 실제 FT체결수량이 있을 때만 FILLED로 판정한다', () => {
  const order = normalizeOrderRow({
    odno: 'US-FILLED-1',
    pdno: 'AAPL',
    sll_buy_dvsn_cd: '01',
    ft_ord_qty: '5',
    ft_ccld_qty: '5',
    nccs_qty: '0',
    ft_ccld_unpr3: '210.25',
    prcs_stat_name: '완료'
  }, 'US', 'USD');

  assert.equal(order.status, 'FILLED');
  assert.equal(order.side, 'SELL');
  assert.equal(order.averageFilledPrice, 210.25);
});

test('해외 취소 주문은 rvse_cncl_dvsn 02를 사용해 CANCELED로 판정한다', () => {
  const order = normalizeOrderRow({
    odno: 'US-CANCELED-1',
    orgn_odno: 'US-ORIGINAL-1',
    pdno: 'AAPL',
    sll_buy_dvsn_cd: '02',
    rvse_cncl_dvsn: '02',
    rvse_cncl_dvsn_name: '취소',
    prcs_stat_name: '완료',
    ft_ord_qty: '5',
    ft_ccld_qty: '0',
    nccs_qty: '0'
  }, 'US', 'USD');

  assert.equal(order.status, 'CANCELED');
  assert.equal(order.filledQuantity, 0);
});

test('해외 취소 요청 자체가 거부된 행은 CANCELED보다 REJECTED를 우선한다', () => {
  const order = normalizeOrderRow({
    odno: 'US-CANCEL-REJECTED-1',
    orgn_odno: 'US-ORIGINAL-2',
    pdno: 'AAPL',
    rvse_cncl_dvsn: '02',
    ft_ord_qty: '5',
    ft_ccld_qty: '0',
    nccs_qty: '0',
    prcs_stat_name: '거부',
    rjct_rson: 'ORDER_ALREADY_FILLED',
    rjct_rson_name: '취소 불가'
  }, 'US', 'USD');

  assert.equal(order.status, 'REJECTED');
});

test('해외 미체결·부분체결 주문은 nccs_qty 기준으로 열린 상태를 구분한다', () => {
  const accepted = normalizeOrderRow({
    odno: 'US-OPEN-1', ft_ord_qty: '10', ft_ccld_qty: '0', nccs_qty: '10'
  }, 'US', 'USD');
  const partial = normalizeOrderRow({
    odno: 'US-PARTIAL-1', ft_ord_qty: '10', ft_ccld_qty: '3', nccs_qty: '7',
    ft_ccld_unpr3: '50.25'
  }, 'US', 'USD');

  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(partial.status, 'PARTIALLY_FILLED');
  assert.equal(partial.filledQuantity, 3);
  assert.equal(partial.remainingQuantity, 7);
});

test('시장별 종결 사유가 없고 체결도 없는 모호한 행은 UNKNOWN으로 fail-closed 한다', () => {
  const domestic = normalizeOrderRow({
    odno: 'KR-UNKNOWN-1', ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '0'
  }, 'KR', 'KRW');
  const overseas = normalizeOrderRow({
    odno: 'US-UNKNOWN-1', ft_ord_qty: '10', ft_ccld_qty: '0', nccs_qty: '0',
    prcs_stat_name: '완료'
  }, 'US', 'USD');

  assert.equal(domestic.status, 'UNKNOWN');
  assert.equal(overseas.status, 'UNKNOWN');
});

test('체결수량이 주문수량보다 작은데 잔량·종결 사유가 없으면 FILLED가 아니라 UNKNOWN이다', () => {
  const domestic = normalizeOrderRow({
    odno: 'KR-INCOMPLETE-1', ord_qty: '10', tot_ccld_qty: '4', rmn_qty: '0', avg_prvs: '70000'
  }, 'KR', 'KRW');
  const overseas = normalizeOrderRow({
    odno: 'US-INCOMPLETE-1', ft_ord_qty: '10', ft_ccld_qty: '4', nccs_qty: '0', ft_ccld_unpr3: '50.25'
  }, 'US', 'USD');

  assert.equal(domestic.status, 'UNKNOWN');
  assert.equal(overseas.status, 'UNKNOWN');
  assert.equal(domestic.filledQuantity, 4);
  assert.equal(overseas.filledQuantity, 4);
});

test('취소·거부 표식과 양수 잔량이 모순되면 UNKNOWN으로 유지한다', () => {
  const domestic = normalizeOrderRow({
    odno: 'KR-CONTRADICT-1', ord_qty: '10', tot_ccld_qty: '0', rmn_qty: '10',
    cncl_yn: 'Y', cncl_cfrm_qty: '10'
  }, 'KR', 'KRW');
  const overseas = normalizeOrderRow({
    odno: 'US-CONTRADICT-1', ft_ord_qty: '10', ft_ccld_qty: '0', nccs_qty: '10',
    prcs_stat_name: '거부', rjct_rson: 'REJECTED'
  }, 'US', 'USD');

  assert.equal(domestic.status, 'UNKNOWN');
  assert.equal(overseas.status, 'UNKNOWN');
});

test('해외 취소 요청은 처리 완료 전에는 CANCELED로 확정하지 않는다', () => {
  const transmitted = normalizeOrderRow({
    odno: 'US-CANCEL-SENT-1', orgn_odno: 'US-ORIGINAL-SENT-1',
    ft_ord_qty: '5', ft_ccld_qty: '0', nccs_qty: '0',
    rvse_cncl_dvsn: '02', prcs_stat_name: '전송'
  }, 'US', 'USD');

  assert.equal(transmitted.status, 'UNKNOWN');
});

test('해외 거부 사유의 0 sentinel은 REJECTED로 오인하지 않는다', () => {
  const order = normalizeOrderRow({
    odno: 'US-ZERO-REJECT-1', ft_ord_qty: '5', ft_ccld_qty: '0', nccs_qty: '5',
    rjct_rson: '00000000', rjct_rson_name: '0000', prcs_stat_name: '전송'
  }, 'US', 'USD');

  assert.equal(order.status, 'ACCEPTED');
});

test('원주문 부분체결과 연결된 취소확정 행은 체결수량·평단을 병합한다', () => {
  const matched = findOrderHistoryMatch([
    {
      orderNo: 'ORIGINAL-1', originalOrderNo: null, status: 'PARTIALLY_FILLED',
      symbol: '005930', filledQuantity: 4, remainingQuantity: 6, averageFilledPrice: 69_800
    },
    {
      orderNo: 'CANCEL-1', originalOrderNo: 'ORIGINAL-1', status: 'CANCELED',
      symbol: '005930', filledQuantity: 4, remainingQuantity: 0, averageFilledPrice: 0
    }
  ], { kisOrderNo: 'ORIGINAL-1', kisOriginalOrderNo: '12345' });

  assert.equal(matched.status, 'CANCELED');
  assert.equal(matched.filledQuantity, 4);
  assert.equal(matched.averageFilledPrice, 69_800);
  assert.equal(matched.remainingQuantity, 0);
});

test('취소 요청 REJECTED 연결 행과 조직번호는 원주문 상태로 교차 매칭하지 않는다', () => {
  const rows = [{
    orderNo: 'CANCEL-REJECT-1', originalOrderNo: 'ORIGINAL-2', status: 'REJECTED',
    filledQuantity: 0, remainingQuantity: 0, averageFilledPrice: 0
  }];

  assert.equal(findOrderHistoryMatch(rows, {
    kisOrderNo: 'ORIGINAL-2', kisOriginalOrderNo: 'CANCEL-REJECT-1'
  }), null);
});

test('KisTradingService 최종 경계는 global OFF에서 BUY·SELL·취소 POST를 모두 차단한다', async () => {
  const previous = env.enableLiveOrder;
  env.enableLiveOrder = 'false';
  const trading = new KisTradingService(999999);
  try {
    await assert.rejects(
      trading.placeBuyOrder({ market: 'KR', symbol: '005930' }),
      /전역 실주문 실행 설정이 꺼져/
    );
    await assert.rejects(
      trading.placeSellOrder({ market: 'KR', symbol: '005930' }),
      /전역 실주문 실행 설정이 꺼져/
    );
    await assert.rejects(
      trading.cancelOpenOrder({ market: 'KR', symbol: '005930', kisOrderNo: '1' }),
      /전역 실주문 실행 설정이 꺼져/
    );
  } finally {
    env.enableLiveOrder = previous;
  }
});
