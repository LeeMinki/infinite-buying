import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let server;
let panel;

test.before(async () => {
  server = await createServer({
    root: path.join(root, 'frontend'),
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    logLevel: 'error'
  });
  panel = await server.ssrLoadModule('/src/pages/KrRankAutoTradingPanel.jsx');
});

test.after(async () => {
  await server?.close();
});

function renderAttention(attention) {
  return renderToStaticMarkup(React.createElement(panel.KrRankOrderAttentionNotice, { attention }));
}

function renderOrder(overrides = {}) {
  return renderToStaticMarkup(React.createElement(panel.OrdersTable, {
    list: {
      items: [{
        buyOrderId: 1,
        symbol: '000001',
        symbolName: '예시종목',
        buyTime: '2026-09-01 00:11:58',
        buyStatus: 'UNKNOWN',
        buyPrice: null,
        sellTime: null,
        sellPrice: null,
        sellReason: null,
        profitRate: null,
        realizedProfitRate: null,
        ...overrides
      }],
      total: 1,
      hasMore: false,
      loading: false
    }
  }));
}

test('한국 랭킹 UI: 접수 불명은 원래 주문 시각·오류·신규 매수 보류를 알리고 복구 버튼을 만들지 않는다', () => {
  const html = renderAttention({
    status: 'UNKNOWN',
    side: 'BUY',
    symbol: '000001',
    symbolName: '예시종목',
    createdAt: '2026-09-01 00:11:58',
    errorCode: 'EGW00201',
    errorMessage: 'must-not-display-raw-error',
    count: 1
  });
  const originalTimeKst = new Date('2026-09-01T00:11:58Z')
    .toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  assert.match(html, /role="alert"/);
  assert.match(html, /주문 접수 확인 필요 · 신규 매수 보류/);
  assert.ok(html.includes(originalTimeKst));
  assert.match(html, /EGW00201/);
  assert.match(html, /주문·체결 내역과 잔고를 확인/);
  assert.doesNotMatch(html, /접수됐|보유 중|<button|must-not-display-raw-error/);
});

test('한국 랭킹 UI: 여러 미종결 주문은 가장 오래된 주문과 총건수를 표시한다', () => {
  const html = renderAttention({
    status: 'REQUESTED', side: 'SELL', symbol: '000001',
    createdAt: '2026-09-01 00:11:58', errorCode: null, count: 2
  });
  assert.match(html, /매도 주문/);
  assert.match(html, /총 2건/);
  assert.match(html, /가장 오래된 주문/);
});

test('한국 랭킹 UI: 서버에서 미종결 주문이 해소되면 경고를 표시하지 않는다', () => {
  assert.equal(renderAttention(null), '');
  assert.equal(renderAttention(undefined), '');
});

test('한국 랭킹 UI: UNKNOWN 매수는 보유 중이나 손익 0%로 표시하지 않는다', () => {
  const html = renderOrder();
  assert.match(html, /매수 주문 접수 확인 필요/);
  assert.doesNotMatch(html, /<td>보유 중<\/td>|\+0\.00%/);
});

test('한국 랭킹 UI: ACCEPTED 매수는 실제 체결 확인을 기다리는 주문으로 표시한다', () => {
  const html = renderOrder({ buyStatus: 'ACCEPTED' });
  assert.match(html, /매수 체결 확인 중/);
  assert.doesNotMatch(html, /<td>보유 중<\/td>|\+0\.00%/);
});

test('한국 랭킹 UI: 복구로 FAILED가 된 무체결 매수는 요청수량이 있어도 매수 실패로 표시한다', () => {
  const html = renderOrder({ buyStatus: 'FAILED', buyQuantity: 10, buyFilledQuantity: 0 });
  assert.match(html, /<td>매수 실패<\/td>/);
  assert.doesNotMatch(html, /<td>보유 중<\/td>|<td[^>]*>진행 중<\/td>|\+0\.00%/);
});

test('한국 랭킹 UI: 무체결 거절·취소 주문은 각각 매수 거절·취소로 표시한다', () => {
  for (const [buyStatus, reason] of [['REJECTED', '매수 거절'], ['CANCELED', '매수 취소']]) {
    const html = renderOrder({ buyStatus, buyQuantity: 10, buyFilledQuantity: 0 });
    assert.ok(html.includes(`<td>${reason}</td>`));
    assert.doesNotMatch(html, /<td>보유 중<\/td>|체결분 보유|\+0\.00%/);
  }
});

test('한국 랭킹 UI: 취소 전 체결수량이나 확인된 체결가가 있으면 체결분 보유를 알린다', () => {
  for (const fillEvidence of [{ buyFilledQuantity: 2 }, { buyPrice: 1000 }]) {
    const html = renderOrder({ buyStatus: 'CANCELED', buyQuantity: 10, ...fillEvidence });
    assert.match(html, /<td>체결분 보유 · 잔여 매수 취소<\/td>/);
    assert.doesNotMatch(html, /<td>매수 취소<\/td>/);
  }
});

test('한국 랭킹 UI: UNKNOWN 매도는 목표 주문 접수 완료로 표시하지 않는다', () => {
  const html = renderOrder({
    buyStatus: 'FILLED', buyPrice: 1000,
    sellStatus: 'UNKNOWN', sellReason: 'TARGET',
    sellTime: '2026-09-01 01:00:00'
  });
  assert.match(html, /매도 주문 접수 확인 필요/);
  assert.doesNotMatch(html, /목표 수익 주문 접수됨|\+0\.00%/);
});

test('한국 랭킹 UI: 실제 확인된 손익 0은 미확정 값과 구분해 표시한다', () => {
  const html = renderOrder({
    buyStatus: 'FILLED', buyPrice: 1000,
    sellStatus: 'FILLED', sellPrice: 1000,
    sellTime: '2026-09-01 01:00:00', sellReason: 'TIME_LIQUIDATE',
    profitRate: 0, realizedProfitRate: 0
  });
  assert.equal((html.match(/\+0\.00%/g) || []).length, 2);
  assert.doesNotMatch(html, /<td>접수 확인 필요<\/td>/);
});
