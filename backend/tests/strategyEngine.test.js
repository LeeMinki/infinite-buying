import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDay, initialState } from '../src/services/strategyEngine.js';
import { TradingMode, Decision } from '../src/domain/tradingMode.js';

const params = {
  totalBudget: 4000000,
  splitCount: 40,
  targetProfitRate: 0.1,
  restartAfterSell: false
};

test('첫 매수: 평단가 없으니 시가에 floor(T/시가)주 매수', () => {
  // T = 4_000_000 / 40 = 100_000. 시가 50_000 → 2주.
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 50000, high: 51000, low: 49000, close: 50500 },
    prevClose: null,
    params,
    state: initialState(params),
    tradeDate: '2026-01-02'
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, Decision.BUY);
  assert.equal(decisions[0].quantity, 2);
  assert.equal(decisions[0].price, 50000);
  assert.equal(decisions[0].reason.includes('첫 매수'), true);
  assert.equal(nextState.holdingQuantity, 2);
  assert.equal(nextState.currentRound, 1);
});

test('평단가 매수와 큰수 매수가 모두 체결되는 날', () => {
  // 평단가 50_000, 전일 종가 50_000, 큰수 매수 상한 55_000.
  // 종가 49_500 → 평단가 매수와 큰수 매수가 모두 체결.
  const state = {
    cash: 3900000, holdingQuantity: 2, averagePrice: 50000,
    investedAmount: 100000, realizedProfit: 0, currentRound: 1, completed: false
  };
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 49800, high: 50000, low: 49000, close: 49500 },
    prevClose: 50000,
    params,
    state,
    tradeDate: '2026-01-03'
  });
  const buys = decisions.filter((d) => d.decision === Decision.BUY);
  assert.equal(buys.length, 2);
  assert.equal(buys[0].reason.includes('평단가 매수'), true);
  assert.equal(buys[1].reason.includes('큰수 매수'), true);
  // half = 50_000, qty = floor(50_000 / 49_500) = 1.
  assert.equal(buys[0].quantity, 1);
});

test('큰 하락일: 평단가 매수 + 큰수 매수 둘 다 체결', () => {
  // 평단가 50_000, 전일 종가 50_000. 종가 47_000 → 둘 다 체결.
  const state = {
    cash: 3900000, holdingQuantity: 2, averagePrice: 50000,
    investedAmount: 100000, realizedProfit: 0, currentRound: 1, completed: false
  };
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 48000, high: 49000, low: 46500, close: 47000 },
    prevClose: 50000,
    params,
    state,
    tradeDate: '2026-01-04'
  });
  const buys = decisions.filter((d) => d.decision === Decision.BUY);
  assert.equal(buys.length, 2);
  assert.equal(buys[0].reason.includes('평단가 매수'), true);
  assert.equal(buys[1].reason.includes('큰수 매수'), true);
  // 시가가 지정가보다 낮으면 시가에 체결된다.
  assert.equal(buys[0].price, 48000);
  assert.equal(buys[1].price, 48000);
});

test('상승일: 둘 다 한도 초과 → HOLD', () => {
  const state = {
    cash: 3900000, holdingQuantity: 2, averagePrice: 50000,
    investedAmount: 100000, realizedProfit: 0, currentRound: 1, completed: false
  };
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 51000, high: 52000, low: 50500, close: 51500 },
    prevClose: 50000,
    params,
    state,
    tradeDate: '2026-01-05'
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, Decision.HOLD);
  assert.equal(decisions[0].reason.includes('관망'), true);
  assert.equal(nextState.currentRound, 1);
});

test('큰수 매수 여유율 0%면 큰수 기준가를 넘는 종가에서는 매수하지 않음', () => {
  const state = {
    cash: 3900000, holdingQuantity: 2, averagePrice: 50000,
    investedAmount: 100000, realizedProfit: 0, currentRound: 1, completed: false
  };
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 52500, high: 53000, low: 52001, close: 52500 },
    prevClose: 52000,
    params: { ...params, bigBuyPremiumRate: 0 },
    state,
    tradeDate: '2026-01-05'
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, Decision.HOLD);
  assert.match(decisions[0].reason, /큰수 지정가/);
  assert.equal(nextState.currentRound, 1);
});

test('큰수 매수 여유율 안이면 전일 종가보다 비싸도 매수 가능', () => {
  const state = {
    cash: 3900000, holdingQuantity: 2, averagePrice: 50000,
    investedAmount: 100000, realizedProfit: 0, currentRound: 1, completed: false
  };
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 52500, high: 53000, low: 52000, close: 52500 },
    prevClose: 52000,
    params: { ...params, totalBudget: 8000000, bigBuyPremiumRate: 0.03 },
    state,
    tradeDate: '2026-01-05'
  });
  const buys = decisions.filter((d) => d.decision === Decision.BUY);
  assert.equal(buys.length, 1);
  assert.equal(buys[0].price, 52500);
  assert.equal(nextState.currentRound, 2);
});

test('익절 매도: 장중 고가 ≥ 평단가 × (1+목표) → 한도가에 전량 매도', () => {
  // 평단가 50_000, 목표 10% → 한도 55_000. 고가 56_000 → 체결.
  const state = {
    cash: 3000000, holdingQuantity: 20, averagePrice: 50000,
    investedAmount: 1000000, realizedProfit: 0, currentRound: 5, completed: false
  };
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 54000, high: 56000, low: 53500, close: 55200 },
    prevClose: 53000,
    params,
    state,
    tradeDate: '2026-01-15'
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, Decision.SELL);
  assert.equal(decisions[0].quantity, 20);
  assert.ok(Math.abs(decisions[0].price - 55000) < 1e-6);
  assert.equal(nextState.holdingQuantity, 0);
  assert.equal(nextState.completed, true);
});

test('익절 + restartAfterSell=true → 사이클 재시작 (round=0)', () => {
  const state = {
    cash: 3000000, holdingQuantity: 20, averagePrice: 50000,
    investedAmount: 1000000, realizedProfit: 0, currentRound: 5, completed: false
  };
  const { nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 54000, high: 56000, low: 53500, close: 55200 },
    prevClose: 53000,
    params: { ...params, restartAfterSell: true },
    state,
    tradeDate: '2026-01-15'
  });
  assert.equal(nextState.completed, false);
  assert.equal(nextState.currentRound, 0);
  assert.equal(nextState.cycleBudget, 4100000);
});

test('익절 후 새 사이클은 늘어난 현금 기준으로 회차 예산을 다시 계산', () => {
  const fractionalParams = {
    totalBudget: 1000,
    splitCount: 40,
    targetProfitRate: 0.1,
    restartAfterSell: true,
    allowFractionalShares: true,
    currency: 'USD'
  };
  const sold = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 43, high: 44, low: 42, close: 44 },
    prevClose: 42,
    params: fractionalParams,
    state: {
      cash: 0,
      holdingQuantity: 25,
      averagePrice: 40,
      investedAmount: 1000,
      realizedProfit: 0,
      currentRound: 5,
      cycleBudget: 1000,
      completed: false
    },
    tradeDate: '2026-01-10'
  });
  assert.equal(sold.nextState.cash, 1100);
  assert.equal(sold.nextState.cycleBudget, 1100);
  assert.equal(sold.nextState.currentRound, 0);

  const restarted = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 44, high: 44, low: 43, close: 43.5 },
    prevClose: 44,
    params: fractionalParams,
    state: sold.nextState,
    tradeDate: '2026-01-11'
  });
  assert.equal(restarted.decisions[0].decision, Decision.BUY);
  assert.equal(restarted.decisions[0].quantity, 0.625);
  assert.match(restarted.decisions[0].reason, /사용 금액은 27.5 USD입니다/);
});

test('40회차 소진 + 현금 부족 → 보유 1/4 매도 (시드 재확보)', () => {
  // 보유 80주, currentRound=40, 현금 50_000 (T=100_000보다 적음).
  const state = {
    cash: 50000, holdingQuantity: 80, averagePrice: 50000,
    investedAmount: 4000000, realizedProfit: 0, currentRound: 40, completed: false
  };
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 49000, high: 50000, low: 48000, close: 49000 },
    prevClose: 49500,
    params,
    state,
    tradeDate: '2026-02-15'
  });
  assert.equal(decisions[0].decision, Decision.SELL);
  // ceil(80/4) = 20
  assert.equal(decisions[0].quantity, 20);
  assert.equal(decisions[0].price, 49000);
  assert.equal(decisions[0].reason.includes('현금 확보'), true);
  assert.equal(nextState.holdingQuantity, 60);
  assert.equal(nextState.averagePrice, 50000);
  assert.equal(nextState.currentRound, 0);
});

test('40회차 소진 + 보유 0 → COMPLETED', () => {
  const state = {
    cash: 100000, holdingQuantity: 0, averagePrice: 0,
    investedAmount: 0, realizedProfit: 0, currentRound: 40, completed: false
  };
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 49000, high: 50000, low: 48000, close: 49000 },
    prevClose: 49500,
    params,
    state,
    tradeDate: '2026-02-15'
  });
  assert.equal(decisions[0].decision, Decision.COMPLETED);
  assert.equal(nextState.completed, true);
});

test('1주도 못 사는 가격: 회차 예산 < 1주 가격 → HOLD with 안내', () => {
  // T = 4_000_000 / 40 = 100_000. 시가 150_000 → floor(100_000/150_000) = 0.
  const { decisions } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 150000, high: 151000, low: 149000, close: 150500 },
    prevClose: null,
    params,
    state: initialState(params),
    tradeDate: '2026-01-02'
  });
  assert.equal(decisions[0].decision, Decision.HOLD);
  assert.equal(decisions[0].reason.includes('매수할 수 없습니다'), true);
});

test('국내/정수주 모드: quantity는 항상 정수', () => {
  const state = {
    cash: 3900000, holdingQuantity: 2, averagePrice: 50000,
    investedAmount: 100000, realizedProfit: 0, currentRound: 1, completed: false
  };
  const { decisions } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 48000, high: 49000, low: 46500, close: 47000 },
    prevClose: 50000,
    params,
    state,
    tradeDate: '2026-01-04'
  });
  for (const d of decisions) {
    if (d.decision === Decision.BUY) {
      assert.equal(Number.isInteger(d.quantity), true);
    }
  }
});

test('해외/소수점 모드: 회차 예산이 1주 가격보다 작아도 매수', () => {
  const fractionalParams = {
    totalBudget: 4000,
    splitCount: 40,
    targetProfitRate: 0.1,
    restartAfterSell: false,
    allowFractionalShares: true
  };
  const { decisions, nextState } = evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 150, high: 151, low: 149, close: 150.5 },
    prevClose: null,
    params: fractionalParams,
    state: initialState(fractionalParams),
    tradeDate: '2026-01-02'
  });
  assert.equal(decisions[0].decision, Decision.BUY);
  assert.equal(decisions[0].quantity, 0.666666);
  assert.equal(nextState.holdingQuantity, 0.666666);
});

test('정수주 모드: 소수점 holdingQuantity 거부', () => {
  assert.throws(() => evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 50000, high: 51000, low: 49000, close: 50500 },
    prevClose: null,
    params,
    state: { cash: 100, holdingQuantity: 0.5, averagePrice: 0, investedAmount: 0, realizedProfit: 0, currentRound: 0, completed: false },
    tradeDate: '2026-01-02'
  }));
});

test('소수점 모드: 소수점 holdingQuantity 허용', () => {
  assert.doesNotThrow(() => evaluateDay({
    mode: TradingMode.BACKTEST,
    ohlc: { open: 50, high: 51, low: 49, close: 50.5 },
    prevClose: null,
    params: { ...params, allowFractionalShares: true },
    state: { cash: 100, holdingQuantity: 0.5, averagePrice: 50, investedAmount: 25, realizedProfit: 0, currentRound: 1, completed: false },
    tradeDate: '2026-01-02'
  }));
});

test('initial_state has currentRound=0', () => {
  const s = initialState(params);
  assert.equal(s.currentRound, 0);
  assert.equal(s.holdingQuantity, 0);
  assert.equal(s.cash, params.totalBudget);
});
