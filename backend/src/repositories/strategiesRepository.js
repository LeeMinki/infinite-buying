import { getDb } from '../db/connection.js';

export function listStrategies() {
  return getDb().prepare('SELECT * FROM strategies ORDER BY id DESC').all().map(toStrategy);
}

export function getStrategy(id) {
  const row = getDb().prepare('SELECT * FROM strategies WHERE id = ?').get(id);
  return row ? toStrategy(row) : null;
}

export function createStrategy(input) {
  const buyAmountPerRound = Math.floor(input.totalBudget / input.splitCount);
  const result = getDb().prepare(`
    INSERT INTO strategies (
      name, stock_code, stock_name, total_budget, split_count,
      buy_amount_per_round, target_profit_rate, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.name,
    input.stockCode,
    input.stockName,
    input.totalBudget,
    input.splitCount,
    buyAmountPerRound,
    input.targetProfitRate,
    input.status
  );
  return getStrategy(result.lastInsertRowid);
}

export function updateStrategy(id, input) {
  const buyAmountPerRound = Math.floor(input.totalBudget / input.splitCount);
  getDb().prepare(`
    UPDATE strategies
    SET name = ?, stock_code = ?, stock_name = ?, total_budget = ?, split_count = ?,
        buy_amount_per_round = ?, target_profit_rate = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name,
    input.stockCode,
    input.stockName,
    input.totalBudget,
    input.splitCount,
    buyAmountPerRound,
    input.targetProfitRate,
    input.status,
    id
  );
  return getStrategy(id);
}

export function deleteStrategy(id) {
  return getDb().prepare('DELETE FROM strategies WHERE id = ?').run(id).changes > 0;
}

export function incrementRound(strategyId) {
  getDb().prepare(`
    UPDATE strategies
    SET current_round = current_round + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(strategyId);
}

function toStrategy(row) {
  return {
    id: row.id,
    name: row.name,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    totalBudget: row.total_budget,
    splitCount: row.split_count,
    buyAmountPerRound: row.buy_amount_per_round,
    targetProfitRate: row.target_profit_rate,
    currentRound: row.current_round,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
