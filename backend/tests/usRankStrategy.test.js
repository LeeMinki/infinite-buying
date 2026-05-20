import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';
import {
  MAX_FLUCTUATION_RATE,
  computeBuyQuantity,
  etTradeDate,
  evaluateSell,
  isUsForceCloseTime,
  isUsRegularSession,
  makeUsRankIdempotencyKey,
  parseHhmmMinutes,
  selectRankingCandidate
} from '../src/services/usRankStrategyEngine.js';

const tmp = useTempDb();
const db = await bootstrapDb();
const repo = await import('../src/repositories/usRankRepository.js');

const user = createUser(db, 'us-rank@example.com');

test.after(() => tmp.cleanup());

test('미국 정규장은 ET 평일 09:30~16:00만 true', () => {
  assert.equal(isUsRegularSession(new Date('2026-05-18T13:29:00Z')), false); // 월 09:29 ET
  assert.equal(isUsRegularSession(new Date('2026-05-18T13:30:00Z')), true); // 월 09:30 ET
  assert.equal(isUsRegularSession(new Date('2026-05-18T19:59:00Z')), true); // 월 15:59 ET
  assert.equal(isUsRegularSession(new Date('2026-05-18T20:00:00Z')), false); // 월 16:00 ET
  assert.equal(isUsRegularSession(new Date('2026-05-17T14:00:00Z')), false); // 일요일
});

test('미국 정규장 판정은 DST 전후에도 ET 기준으로 동작한다', () => {
  assert.equal(isUsRegularSession(new Date('2026-01-05T14:30:00Z')), true); // 겨울 09:30 ET
  assert.equal(isUsRegularSession(new Date('2026-07-06T13:30:00Z')), true); // 여름 09:30 ET
});

test('강제 청산은 미국장이 열려 있고 KST 새벽 설정 시각 이후에만 true', () => {
  assert.equal(isUsForceCloseTime(new Date('2026-05-19T19:29:00Z'), '04:30'), false); // KST 04:29
  assert.equal(isUsForceCloseTime(new Date('2026-05-19T19:30:00Z'), '04:30'), true); // KST 04:30
  assert.equal(isUsForceCloseTime(new Date('2026-05-19T13:30:00Z'), '04:30'), false); // KST 22:30, 미국장 시작
});

test('ET 거래일 문자열을 반환한다', () => {
  assert.equal(etTradeDate(new Date('2026-05-19T03:00:00Z')), '2026-05-18');
});

test('HH:MM 파싱과 잘못된 형식을 구분한다', () => {
  assert.equal(parseHhmmMinutes('04:30'), 270);
  assert.equal(parseHhmmMinutes('4:30'), 270);
  assert.equal(parseHhmmMinutes('24:00'), null);
  assert.equal(parseHhmmMinutes('04:60'), null);
});

test('등락률 상한 미만의 첫 매수 후보를 선택한다', () => {
  const ranking = [
    { symbol: 'AAA', name: '과열', price: 10, fluctuationRate: 0.25 },
    { symbol: 'BBB', name: '후보', price: 20, fluctuationRate: 0.19 }
  ];
  const picked = selectRankingCandidate(ranking, { maxFluctuationRate: MAX_FLUCTUATION_RATE });
  assert.equal(picked.symbol, 'BBB');
});

test('매수 수량은 1주 단위 정수로 계산한다', () => {
  assert.equal(computeBuyQuantity(1000, 333.3), 3);
  assert.equal(computeBuyQuantity(99, 100), 0);
});

test('매도 판단은 TARGET, STOP_LOSS, FORCE_CLOSE 우선순위를 따른다', () => {
  assert.equal(evaluateSell({ currentPrice: 102, averagePrice: 100, targetProfitRate: 0.02, stopLossRate: 0.05 }).sellReason, 'TARGET');
  assert.equal(evaluateSell({ currentPrice: 94.9, averagePrice: 100, targetProfitRate: 0.02, stopLossRate: 0.05 }).sellReason, 'STOP_LOSS');
  assert.equal(evaluateSell({ currentPrice: 99, averagePrice: 100, targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseTriggered: true }).sellReason, 'FORCE_CLOSE');
});

test('멱등키는 날짜, 전략, 매매 회차, 방향으로 구성된다', () => {
  assert.equal(makeUsRankIdempotencyKey({ tradeDate: '2026-05-18', strategyId: 7, tradeSeq: 3, side: 'BUY' }), '20260518-7-3-BUY');
});

test('레포지토리는 거래 회차 증가, day lock 해제, 중복 주문 조회를 처리한다', () => {
  const strategy = repo.createStrategy(user.id, {
    autoBudgetEnabled: false,
    fixedBuyUsdAmount: 1000,
    targetProfitRate: 0.02,
    stopLossRate: 0.05,
    maxFluctuationRate: 0.2,
    forceCloseKst: '04:30',
    exchange: 'NAS'
  });
  const first = repo.createTrade(user.id, {
    strategyId: strategy.id,
    tradeDate: '2026-05-18',
    tradeSeq: repo.nextTradeSeq(strategy.id, '2026-05-18'),
    symbol: 'TQQQ',
    status: 'SELECTED'
  });
  assert.equal(first.tradeSeq, 1);
  assert.equal(repo.nextTradeSeq(strategy.id, '2026-05-18'), 2);

  repo.setDayLockedOut(user.id, strategy.id, { tradeDate: '2026-05-18', reason: 'STOP_LOSS' });
  assert.equal(repo.getStrategy(user.id, strategy.id).dayLockedOut, true);
  assert.equal(repo.clearDayLockedOutIfStale(user.id, strategy.id, '2026-05-19').dayLockedOut, false);

  const key = '20260518-1-1-BUY';
  repo.createOrder(user.id, {
    strategyId: strategy.id,
    tradeId: first.id,
    symbol: 'TQQQ',
    side: 'BUY',
    quantity: 1,
    orderPrice: 100,
    estimatedAmount: 100,
    idempotencyKey: key,
    decisionReason: 'test',
    liveOrderEnabled: false,
    status: 'DRY_RUN'
  });
  assert.equal(repo.hasDuplicateOrder(key), true);
  assert.equal(repo.hasNonFailedOrder(key), true);
});
