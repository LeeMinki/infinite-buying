import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate, initialState } from '../src/services/strategyEngine.js';
import { TradingMode, Decision } from '../src/domain/tradingMode.js';

const params = {
  totalBudget: 4000000,
  splitCount: 40,
  targetProfitRate: 0.1,
  restartAfterSell: false
};

test('first BUY uses base round quantity (totalBudget/splitCount/price)', () => {
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 50000,
    params,
    state: initialState(params)
  });
  assert.equal(result.decision, Decision.BUY);
  assert.equal(result.quantity, 2);
  assert.equal(result.amount, 100000);
  assert.equal(result.nextState.cash, 3900000);
  assert.equal(result.nextState.holdingQuantity, 2);
  assert.equal(result.nextState.averagePrice, 50000);
  assert.equal(result.nextState.currentRound, 2);
});

test('SELL fires when target profit reached and resets holdings', () => {
  const state = {
    cash: 3900000,
    holdingQuantity: 2,
    averagePrice: 50000,
    investedAmount: 100000,
    realizedProfit: 0,
    currentRound: 2,
    completed: false
  };
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 56000,
    params,
    state
  });
  assert.equal(result.decision, Decision.SELL);
  assert.equal(result.quantity, 2);
  assert.equal(result.amount, 112000);
  assert.equal(result.nextState.holdingQuantity, 0);
  assert.equal(result.nextState.averagePrice, 0);
  assert.equal(result.nextState.realizedProfit, 12000);
  assert.equal(result.nextState.completed, true);
});

test('SELL with restartAfterSell=true keeps run active and resets round to 1', () => {
  const state = {
    cash: 3900000,
    holdingQuantity: 2,
    averagePrice: 50000,
    investedAmount: 100000,
    realizedProfit: 0,
    currentRound: 5,
    completed: false
  };
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 56000,
    params: { ...params, restartAfterSell: true },
    state
  });
  assert.equal(result.decision, Decision.SELL);
  assert.equal(result.nextState.completed, false);
  assert.equal(result.nextState.currentRound, 1);
});

test('cheap day (price < avg) BUYs double the base quantity', () => {
  const state = {
    cash: 3900000,
    holdingQuantity: 2,
    averagePrice: 50000,
    investedAmount: 100000,
    realizedProfit: 0,
    currentRound: 2,
    completed: false
  };
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 40000,
    params,
    state
  });
  assert.equal(result.decision, Decision.BUY);
  assert.equal(result.quantity, 4);
  assert.equal(result.amount, 160000);
  assert.equal(result.nextState.holdingQuantity, 6);
  assert.equal(result.nextState.investedAmount, 260000);
  assert.ok(Math.abs(result.nextState.averagePrice - 260000 / 6) < 1e-9);
  assert.match(result.reason, /2배 수량/);
});

test('expensive day (price >= avg) BUYs roughly half the base quantity (floor with min 1)', () => {
  const state = {
    cash: 3900000,
    holdingQuantity: 4,
    averagePrice: 40000,
    investedAmount: 160000,
    realizedProfit: 0,
    currentRound: 5,
    completed: false
  };
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 42000,
    params,
    state
  });
  assert.equal(result.decision, Decision.BUY);
  // baseQty = floor(100000/42000) = 2 → half = 1
  assert.equal(result.quantity, 1);
  assert.equal(result.amount, 42000);
  assert.match(result.reason, /절반 수량/);
});

test('HOLD when per-round budget cannot buy a single share', () => {
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 200000,
    params,
    state: initialState(params)
  });
  assert.equal(result.decision, Decision.HOLD);
  assert.match(result.reason, /1주를 매수할 수 없/);
});

test('after splitCount rounds completed, sells 1/4 of holdings to refresh seed', () => {
  const state = {
    cash: 0,
    holdingQuantity: 8,
    averagePrice: 50000,
    investedAmount: 400000,
    realizedProfit: 0,
    currentRound: 41,
    completed: false
  };
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 49000,
    params,
    state
  });
  assert.equal(result.decision, Decision.SELL);
  assert.equal(result.quantity, 2);
  assert.equal(result.amount, 98000);
  assert.equal(result.nextState.holdingQuantity, 6);
  assert.equal(result.nextState.averagePrice, 50000);
  assert.equal(result.nextState.cash, 98000);
  assert.equal(result.nextState.currentRound, 1);
  assert.equal(result.nextState.completed, false);
  assert.match(result.reason, /1\/4|시드 재확보/);
});

test('COMPLETED when max round exhausted and no holdings', () => {
  const state = {
    cash: 0,
    holdingQuantity: 0,
    averagePrice: 0,
    investedAmount: 0,
    realizedProfit: 0,
    currentRound: 41,
    completed: false
  };
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 49000,
    params,
    state
  });
  assert.equal(result.decision, Decision.COMPLETED);
  assert.equal(result.nextState.completed, true);
});

test('rejects non-positive price', () => {
  assert.throws(() => evaluate({
    mode: TradingMode.BACKTEST,
    price: 0,
    params,
    state: initialState(params)
  }));
});

test('rejects unknown mode', () => {
  assert.throws(() => evaluate({
    mode: 'PAPER',
    price: 50000,
    params,
    state: initialState(params)
  }));
});

test('returnRate metric reflects total asset minus budget', () => {
  const state = {
    cash: 3900000,
    holdingQuantity: 2,
    averagePrice: 50000,
    investedAmount: 100000,
    realizedProfit: 0,
    currentRound: 2,
    completed: false
  };
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 60000,
    params,
    state
  });
  // 60k >= 50k*1.1 → SELL ALL
  assert.equal(result.decision, Decision.SELL);
  assert.equal(result.metrics.totalAsset, 3900000 + 60000 * 2);
  const expected = (3900000 + 120000 - 4000000) / 4000000;
  assert.ok(Math.abs(result.metrics.returnRate - expected) < 1e-9);
});

test('default restartAfterSell is true (Laor canonical)', () => {
  const result = evaluate({
    mode: TradingMode.BACKTEST,
    price: 56000,
    params: { totalBudget: 4000000, splitCount: 40, targetProfitRate: 0.1 },
    state: {
      cash: 3900000,
      holdingQuantity: 2,
      averagePrice: 50000,
      investedAmount: 100000,
      realizedProfit: 0,
      currentRound: 5,
      completed: false
    }
  });
  assert.equal(result.decision, Decision.SELL);
  assert.equal(result.nextState.completed, false);
  assert.equal(result.nextState.currentRound, 1);
});
