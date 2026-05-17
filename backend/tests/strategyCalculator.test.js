import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateStrategy } from '../src/services/strategyCalculator.js';

const strategy = {
  status: 'ACTIVE',
  targetProfitRate: 0.1,
  buyAmountPerRound: 100000,
  currentRound: 1,
  splitCount: 40
};

test('returns PAUSE for paused strategy', () => {
  const result = evaluateStrategy({
    strategy: { ...strategy, status: 'PAUSED' },
    holding: { quantity: 0, averagePrice: 0, remainingBudget: 1000000 },
    currentPrice: 50000
  });
  assert.equal(result.decision, 'PAUSE');
});

test('returns SELL when target profit is reached', () => {
  const result = evaluateStrategy({
    strategy,
    holding: { quantity: 3, averagePrice: 10000, remainingBudget: 900000 },
    currentPrice: 11000
  });
  assert.equal(result.decision, 'SELL');
  assert.equal(result.quantity, 3);
});

test('returns BUY when one round can buy shares', () => {
  const result = evaluateStrategy({
    strategy,
    holding: { quantity: 0, averagePrice: 0, remainingBudget: 1000000 },
    currentPrice: 25000
  });
  assert.equal(result.decision, 'BUY');
  assert.equal(result.quantity, 4);
});

test('returns HOLD when per-round amount cannot buy one share', () => {
  const result = evaluateStrategy({
    strategy,
    holding: { quantity: 0, averagePrice: 0, remainingBudget: 1000000 },
    currentPrice: 150000
  });
  assert.equal(result.decision, 'HOLD');
});

test('returns HOLD when rounds are exhausted', () => {
  const result = evaluateStrategy({
    strategy: { ...strategy, currentRound: 41 },
    holding: { quantity: 0, averagePrice: 0, remainingBudget: 1000000 },
    currentPrice: 25000
  });
  assert.equal(result.decision, 'HOLD');
});

test('returns HOLD when budget is exhausted', () => {
  const result = evaluateStrategy({
    strategy,
    holding: { quantity: 0, averagePrice: 0, remainingBudget: 0 },
    currentPrice: 25000
  });
  assert.equal(result.decision, 'HOLD');
});

test('returns HOLD when price is above big-number buy ceiling', () => {
  // 큰수 매수 상한 = 평단가 50000 × 1.02 = 51000. previousClose(200000)는 무관해야 한다.
  const result = evaluateStrategy({
    strategy: { ...strategy, previousClose: 200000, bigBuyPremiumRate: 0.02 },
    holding: { quantity: 2, averagePrice: 50000, remainingBudget: 1000000 },
    currentPrice: 52100
  });
  assert.equal(result.decision, 'HOLD');
});

test('returns BUY when price is within big-number buy ceiling', () => {
  // 큰수 매수 상한 = 평단가 50000 × 1.05 = 52500. previousClose(5000)는 무관해야 한다.
  const result = evaluateStrategy({
    strategy: { ...strategy, buyAmountPerRound: 200000, previousClose: 5000, bigBuyPremiumRate: 0.05 },
    holding: { quantity: 2, averagePrice: 50000, remainingBudget: 1000000 },
    currentPrice: 52000
  });
  assert.equal(result.decision, 'BUY');
});
