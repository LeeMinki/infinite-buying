import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';
import {
  computeBuyQuantity,
  computeCycleProfitRate,
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

test('상승률 순위의 첫 유효 후보를 선택한다 (등락률 상한 없음)', () => {
  const ranking = [
    { symbol: 'AAA', name: '1위', price: 10, fluctuationRate: 0.35 },
    { symbol: 'BBB', name: '2위', price: 20, fluctuationRate: 0.19 }
  ];
  const picked = selectRankingCandidate(ranking);
  assert.equal(picked.symbol, 'AAA');
});

test('가격 0이거나 등락률 파싱 실패 종목은 건너뛴다', () => {
  const ranking = [
    { symbol: 'BAD1', price: 0, fluctuationRate: 0.5 },
    { symbol: 'BAD2', price: 10, fluctuationRate: NaN },
    { symbol: 'OK', price: 10, fluctuationRate: 0.1 }
  ];
  assert.equal(selectRankingCandidate(ranking).symbol, 'OK');
});

test('매수 수량은 1주 단위 정수로 계산한다', () => {
  assert.equal(computeBuyQuantity(1000, 333.3), 3);
  assert.equal(computeBuyQuantity(99, 100), 0);
});

test('매도 판단 우선순위: CYCLE > STOP > TARGET > FORCE > HOLD', () => {
  // 익절 도달
  assert.equal(evaluateSell({ currentPrice: 102, averagePrice: 100, targetProfitRate: 0.02, stopLossRate: 0.05 }).sellReason, 'TARGET');
  // 손절 도달
  assert.equal(evaluateSell({ currentPrice: 94.9, averagePrice: 100, targetProfitRate: 0.02, stopLossRate: 0.05 }).sellReason, 'STOP_LOSS');
  // 익절·손절 모두 안 닿았는데 강제 청산 시각 도달
  assert.equal(evaluateSell({ currentPrice: 99, averagePrice: 100, targetProfitRate: 0.02, stopLossRate: 0.05, forceCloseTriggered: true }).sellReason, 'FORCE_CLOSE');
  // 사이클 목표 도달은 다른 모든 조건을 압도(영구 종료 트리거)
  assert.equal(evaluateSell({ currentPrice: 102, averagePrice: 100, targetProfitRate: 0.02, stopLossRate: 0.05, cycleTargetReached: true }).sellReason, 'CYCLE_COMPLETE');
  // 손절·익절 동시 도달은 불가능하지만 익절보다 손절이 먼저 평가됨 검증
  assert.equal(evaluateSell({ currentPrice: 95, averagePrice: 100, targetProfitRate: -0.01, stopLossRate: 0.05 }).sellReason, 'STOP_LOSS');
});

test('누적 수익률 계산: 현금 + 보유 평가액', () => {
  // baseline 1000, 현금 600, 보유 5주 * 100 = 500 → 총 1100 → +10%
  assert.equal(computeCycleProfitRate({ baselineUsd: 1000, cashAvailable: 600, holdingQuantity: 5, currentPrice: 100 }), 0.1);
  // baseline 1000, 현금만 1200 (보유 없음) → +20%
  assert.equal(computeCycleProfitRate({ baselineUsd: 1000, cashAvailable: 1200, holdingQuantity: 0, currentPrice: 0 }), 0.2);
  // baseline 누락이면 null
  assert.equal(computeCycleProfitRate({ baselineUsd: 0, cashAvailable: 100 }), null);
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
