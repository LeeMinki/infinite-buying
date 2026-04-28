export function evaluateStrategy({ strategy, holding, currentPrice, today = new Date() }) {
  const price = Number(currentPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Current price must be greater than zero');
  }

  if (strategy.status === 'PAUSED') {
    return { decision: 'PAUSE', quantity: 0, amount: 0, roundNo: strategy.currentRound, reason: 'Strategy is paused' };
  }

  if (holding.quantity > 0 && price >= holding.averagePrice * (1 + strategy.targetProfitRate)) {
    return {
      decision: 'SELL',
      quantity: holding.quantity,
      amount: Math.floor(price * holding.quantity),
      roundNo: strategy.currentRound,
      reason: 'Target profit reached'
    };
  }

  if (strategy.currentRound > strategy.splitCount || holding.remainingBudget <= 0) {
    return { decision: 'HOLD', quantity: 0, amount: 0, roundNo: strategy.currentRound, reason: 'No remaining buy capacity' };
  }

  const availableAmount = Math.min(strategy.buyAmountPerRound, holding.remainingBudget);
  const quantity = Math.floor(availableAmount / price);
  if (quantity <= 0) {
    return {
      decision: 'HOLD',
      quantity: 0,
      amount: 0,
      roundNo: strategy.currentRound,
      reason: 'Per-round amount cannot buy one share'
    };
  }

  return {
    decision: 'BUY',
    quantity,
    amount: Math.floor(quantity * price),
    roundNo: strategy.currentRound,
    reason: 'Buy conditions met'
  };
}
