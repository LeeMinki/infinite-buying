import { getDb } from '../db/connection.js';

export function createHolding(userId, strategyId, totalBudget) {
  getDb().prepare(`
    INSERT INTO holdings (user_id, strategy_id, remaining_budget)
    VALUES (?, ?, ?)
  `).run(userId, strategyId, totalBudget);
  return getHoldingByStrategy(userId, strategyId);
}

export function getHoldingByStrategy(userId, strategyId) {
  const row = getDb().prepare('SELECT * FROM holdings WHERE user_id = ? AND strategy_id = ?').get(userId, strategyId);
  return row ? toHolding(row) : null;
}

export function updateHoldingAfterBuy(userId, strategyId, order) {
  const holding = getHoldingByStrategy(userId, strategyId);
  const quantity = holding.quantity + order.quantity;
  const investedAmount = holding.investedAmount + order.amount;
  const averagePrice = quantity > 0 ? investedAmount / quantity : 0;
  const remainingBudget = Math.max(0, holding.remainingBudget - order.amount);
  getDb().prepare(`
    UPDATE holdings
    SET quantity = ?, average_price = ?, invested_amount = ?, remaining_budget = ?, updated_at = datetime('now')
    WHERE user_id = ? AND strategy_id = ?
  `).run(quantity, averagePrice, investedAmount, remainingBudget, userId, strategyId);
  return getHoldingByStrategy(userId, strategyId);
}

export function updateHoldingAfterSell(userId, strategyId, order) {
  const holding = getHoldingByStrategy(userId, strategyId);
  if (order.quantity > holding.quantity) {
    const error = new Error('Sell quantity exceeds holding quantity');
    error.status = 409;
    throw error;
  }
  const quantity = holding.quantity - order.quantity;
  const realizedProfit = holding.realizedProfit + Math.round((order.price - holding.averagePrice) * order.quantity);
  const investedAmount = quantity > 0 ? Math.round(holding.averagePrice * quantity) : 0;
  const averagePrice = quantity > 0 ? holding.averagePrice : 0;
  const remainingBudget = holding.remainingBudget + order.amount;
  getDb().prepare(`
    UPDATE holdings
    SET quantity = ?, average_price = ?, invested_amount = ?, remaining_budget = ?,
        realized_profit = ?, updated_at = datetime('now')
    WHERE user_id = ? AND strategy_id = ?
  `).run(quantity, averagePrice, investedAmount, remainingBudget, realizedProfit, userId, strategyId);
  return getHoldingByStrategy(userId, strategyId);
}

function toHolding(row) {
  return {
    id: row.id,
    userId: row.user_id,
    strategyId: row.strategy_id,
    quantity: row.quantity,
    averagePrice: row.average_price,
    investedAmount: row.invested_amount,
    remainingBudget: row.remaining_budget,
    realizedProfit: row.realized_profit,
    updatedAt: row.updated_at
  };
}
