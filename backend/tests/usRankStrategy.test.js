import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';
import {
  computeBuyQuantity,
  computeCycleProfitRate,
  etTradeDate,
  checkUsBuyCandidate,
  evaluateSell,
  isUsForceCloseTime,
  isUsMarketHoliday,
  isUsRegularSession,
  makeUsRankIdempotencyKey,
  parseHhmmMinutes,
  selectRankingCandidate,
  selectRankingCandidates
} from '../src/services/usRankStrategyEngine.js';

function risingCandles() {
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    const close = 40 + i;
    out.push({ time: String(100000 + i * 100), open: close - 0.5, high: close + 0.2, low: close - 0.7, close, volume: 100000 });
  }
  return out;
}

const tmp = useTempDb();
const db = await bootstrapDb();
const repo = await import('../src/repositories/usRankRepository.js');

const user = createUser(db, 'us-rank@example.com');

test.after(() => tmp.cleanup());

test('미국 정규장은 ET 평일 10:00~16:00만 true', () => {
  assert.equal(isUsRegularSession(new Date('2026-05-18T13:59:00Z')), false); // 월 09:59 ET
  assert.equal(isUsRegularSession(new Date('2026-05-18T14:00:00Z')), true); // 월 10:00 ET
  assert.equal(isUsRegularSession(new Date('2026-05-18T19:59:00Z')), true); // 월 15:59 ET
  assert.equal(isUsRegularSession(new Date('2026-05-18T20:00:00Z')), false); // 월 16:00 ET
  assert.equal(isUsRegularSession(new Date('2026-05-17T14:00:00Z')), false); // 일요일
});

test('미국 정규장 판정은 DST 전후에도 ET 기준으로 동작한다', () => {
  assert.equal(isUsRegularSession(new Date('2026-01-05T14:59:00Z')), false); // 겨울 09:59 ET
  assert.equal(isUsRegularSession(new Date('2026-01-05T15:00:00Z')), true); // 겨울 10:00 ET
  assert.equal(isUsRegularSession(new Date('2026-07-06T13:59:00Z')), false); // 여름 09:59 ET
  assert.equal(isUsRegularSession(new Date('2026-07-06T14:00:00Z')), true); // 여름 10:00 ET
});

test('NYSE 정규 휴장일(2026년)을 규칙으로 판정한다', () => {
  // 고정일·변동일 모두 포함. month는 1-12.
  assert.equal(isUsMarketHoliday(2026, 1, 1), true); // 신정 (목)
  assert.equal(isUsMarketHoliday(2026, 1, 19), true); // MLK (1월 셋째 월)
  assert.equal(isUsMarketHoliday(2026, 2, 16), true); // 대통령의 날 (2월 셋째 월)
  assert.equal(isUsMarketHoliday(2026, 4, 3), true); // 성금요일 (부활절 4/5 직전 금)
  assert.equal(isUsMarketHoliday(2026, 5, 25), true); // 메모리얼데이 (5월 마지막 월)
  assert.equal(isUsMarketHoliday(2026, 6, 19), true); // 준틴스 (금)
  assert.equal(isUsMarketHoliday(2026, 7, 3), true); // 독립기념일 7/4(토) → 7/3(금) 대체
  assert.equal(isUsMarketHoliday(2026, 9, 7), true); // 노동절 (9월 첫째 월)
  assert.equal(isUsMarketHoliday(2026, 11, 26), true); // 추수감사절 (11월 넷째 목)
  assert.equal(isUsMarketHoliday(2026, 12, 25), true); // 크리스마스 (금)
  // 휴장일이 아닌 평일
  assert.equal(isUsMarketHoliday(2026, 5, 26), false);
  assert.equal(isUsMarketHoliday(2026, 7, 6), false);
});

test('정규장 시간이어도 휴장일이면 isUsRegularSession은 false', () => {
  // 2026-05-25(월) 메모리얼데이 10:30 ET (EDT, UTC-4 → 14:30 UTC). 휴장 체크가 없으면 true였을 시각.
  assert.equal(isUsRegularSession(new Date('2026-05-25T14:30:00Z')), false);
  // 다음 평일은 정상 개장
  assert.equal(isUsRegularSession(new Date('2026-05-26T14:30:00Z')), true);
});

test('미국 매수 필터: 상승 추세는 통과, 흐름이 깨지면 거절', () => {
  // 상승 추세(시가<종가·종가 상승·거래량 일정) → 통과
  assert.equal(checkUsBuyCandidate(risingCandles()).ok, true);

  // 분봉 부족 → 거절
  assert.equal(checkUsBuyCandidate(risingCandles().slice(0, 2)).ok, false);

  // 현재가가 VWAP/시작가 아래(하락 추세) → 거절
  const falling = risingCandles().map((c, i) => {
    const close = 49 - i;
    return { ...c, open: close + 0.5, high: close + 0.7, low: close - 0.2, close };
  });
  assert.equal(checkUsBuyCandidate(falling).ok, false);

  // 마지막에 거래량 동반 장대 음봉 → 거절
  const bearish = risingCandles();
  const last = bearish[bearish.length - 1];
  bearish[bearish.length - 1] = { ...last, open: last.close + 5, close: last.close - 5, volume: 1_000_000 };
  assert.equal(checkUsBuyCandidate(bearish).ok, false);
});

test('selectRankingCandidates는 가격·거래량 1차 필터 통과 후보를 상위 N개 반환', () => {
  const ranking = [
    { symbol: 'A', name: 'A', exchange: 'NAS', price: 50, volume: 20_000_000, fluctuationRate: 0.5 },
    { symbol: 'B', name: 'B', exchange: 'NAS', price: 0.5, volume: 20_000_000, fluctuationRate: 0.4 }, // 1달러 미만 제외
    { symbol: 'C', name: 'C', exchange: 'NAS', price: 30, volume: 1_000_000, fluctuationRate: 0.3 }, // 거래량 미달 제외
    { symbol: 'D', name: 'D', exchange: 'NAS', price: 20, volume: 0, fluctuationRate: 0.2 } // 거래량 0 → 서버 필터 신뢰, 통과
  ];
  const picked = selectRankingCandidates(ranking, { limit: 3 }).map((c) => c.symbol);
  assert.deepEqual(picked, ['A', 'D']);
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
    { symbol: 'AAA', name: '1위', price: 10, volume: 15_000_000, fluctuationRate: 0.35 },
    { symbol: 'BBB', name: '2위', price: 20, volume: 20_000_000, fluctuationRate: 0.19 }
  ];
  const picked = selectRankingCandidate(ranking);
  assert.equal(picked.symbol, 'AAA');
});

test('가격 1달러 미만, 거래량 1천만주 미만, 등락률 파싱 실패 종목은 건너뛴다', () => {
  const ranking = [
    { symbol: 'BAD1', price: 0.99, volume: 50_000_000, fluctuationRate: 0.5 },
    { symbol: 'BAD2', price: 10, volume: 9_999_999, fluctuationRate: 0.4 },
    { symbol: 'BAD3', price: 10, volume: 20_000_000, fluctuationRate: NaN },
    { symbol: 'OK', price: 10, volume: 10_000_000, fluctuationRate: 0.1 }
  ];
  assert.equal(selectRankingCandidate(ranking).symbol, 'OK');
});

test('거래량 필드가 비어 있거나 0이면 서버(VOL_RANG) 필터를 신뢰해 통과한다', () => {
  // tvol 필드 누락/0 → 클라이언트 거래량 검사가 전원 탈락시키지 않도록 통과시킨다.
  assert.equal(selectRankingCandidate([{ symbol: 'NV', price: 10, fluctuationRate: 0.3 }]).symbol, 'NV');
  assert.equal(selectRankingCandidate([{ symbol: 'ZV', price: 10, volume: 0, fluctuationRate: 0.3 }]).symbol, 'ZV');
  // 단, 거래량이 유효한 양수로 1천만주 미만이면 여전히 제외.
  assert.equal(selectRankingCandidate([{ symbol: 'LOW', price: 10, volume: 5_000_000, fluctuationRate: 0.3 }]), null);
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

test('누적 손익률 계산: 실현손익 + 미실현 평가손익 (현금 미사용)', () => {
  // baseline 1000, 실현 50, 보유 5주 평단 90 현재가 100 → 미실현 50 → 합 100 → +10%
  assert.equal(computeCycleProfitRate({ baselineUsd: 1000, realizedProfitUsd: 50, holdingQuantity: 5, averagePrice: 90, currentPrice: 100 }), 0.1);
  // baseline 1000, 실현 200, 보유 없음 → +20%
  assert.equal(computeCycleProfitRate({ baselineUsd: 1000, realizedProfitUsd: 200, holdingQuantity: 0, currentPrice: 0 }), 0.2);
  // 매수 직후 평단≈현재가면 미실현≈0 — 현금 정산 지연이 있어도 자산이 부풀지 않는다(사고 재현 방지)
  assert.equal(computeCycleProfitRate({ baselineUsd: 126.26, realizedProfitUsd: 0, holdingQuantity: 389, averagePrice: 0.32, currentPrice: 0.32 }), 0);
  // baseline 누락이면 null
  assert.equal(computeCycleProfitRate({ baselineUsd: 0, realizedProfitUsd: 100 }), null);
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
