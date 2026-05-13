import { getDb } from '../db/connection.js';

export function listStrategies(userId) {
  return getDb().prepare('SELECT * FROM strategies WHERE user_id = ? ORDER BY id DESC').all(userId).map(toStrategy);
}

export function getStrategy(userId, id) {
  const row = getDb().prepare('SELECT * FROM strategies WHERE user_id = ? AND id = ?').get(userId, id);
  return row ? toStrategy(row) : null;
}

export function createStrategy(userId, input) {
  const buyAmountPerRound = Math.floor(input.totalBudget / input.splitCount);
  const result = getDb().prepare(`
    INSERT INTO strategies (
      user_id, name, stock_code, stock_name, total_budget, split_count,
      buy_amount_per_round, target_profit_rate, big_buy_premium_rate, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.name,
    input.stockCode,
    input.stockName,
    input.totalBudget,
    input.splitCount,
    buyAmountPerRound,
    input.targetProfitRate,
    input.bigBuyPremiumRate,
    input.status
  );
  return getStrategy(userId, result.lastInsertRowid);
}

export function updateStrategy(userId, id, input) {
  const buyAmountPerRound = Math.floor(input.totalBudget / input.splitCount);
  getDb().prepare(`
    UPDATE strategies
    SET name = ?, stock_code = ?, stock_name = ?, total_budget = ?, split_count = ?,
        buy_amount_per_round = ?, target_profit_rate = ?, big_buy_premium_rate = ?, status = ?, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(
    input.name,
    input.stockCode,
    input.stockName,
    input.totalBudget,
    input.splitCount,
    buyAmountPerRound,
    input.targetProfitRate,
    input.bigBuyPremiumRate,
    input.status,
    userId,
    id
  );
  return getStrategy(userId, id);
}

export function deleteStrategy(userId, id) {
  return getDb().prepare('DELETE FROM strategies WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}

export function incrementRound(userId, strategyId) {
  getDb().prepare(`
    UPDATE strategies
    SET current_round = current_round + 1, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, strategyId);
}

function toStrategy(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    totalBudget: row.total_budget,
    splitCount: row.split_count,
    buyAmountPerRound: row.buy_amount_per_round,
    targetProfitRate: row.target_profit_rate,
    bigBuyPremiumRate: row.big_buy_premium_rate ?? 0.1,
    currentRound: row.current_round,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
