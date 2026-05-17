import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeExchange } from '../src/services/kisTradingService.js';

// KIS 거래 API(주문·잔고·매수가능금액)는 거래소 코드를 NASD/NYSE/AMEX로 받는다.
// 종목 검색이 주는 시세용 코드(NAS/NYS/AMS)를 그대로 보내면 APBN0746(상품이 없습니다)로 거절된다.

test('시세용 거래소 코드를 거래용 코드로 변환한다', () => {
  assert.equal(normalizeExchange('NAS'), 'NASD');
  assert.equal(normalizeExchange('NYS'), 'NYSE');
  assert.equal(normalizeExchange('AMS'), 'AMEX');
});

test('이미 거래용 코드면 그대로 둔다', () => {
  assert.equal(normalizeExchange('NASD'), 'NASD');
  assert.equal(normalizeExchange('NYSE'), 'NYSE');
  assert.equal(normalizeExchange('AMEX'), 'AMEX');
});

test('소문자·공백·전체 이름도 정규화한다', () => {
  assert.equal(normalizeExchange(' ams '), 'AMEX');
  assert.equal(normalizeExchange('nasdaq'), 'NASD');
});

test('값이 없으면 NASD를 기본으로 쓴다', () => {
  assert.equal(normalizeExchange(''), 'NASD');
  assert.equal(normalizeExchange(null), 'NASD');
  assert.equal(normalizeExchange(undefined), 'NASD');
});
