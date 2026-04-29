import { getDb } from '../db/connection.js';

export function listLogs(userId, strategyId) {
  return getDb().prepare(`
    SELECT * FROM decision_logs
    WHERE user_id = ? AND strategy_id = ?
    ORDER BY id DESC
    LIMIT 100
  `).all(userId, strategyId).map(toLog);
}

export function createDecisionLog(input) {
  const result = getDb().prepare(`
    INSERT INTO decision_logs (
      user_id, strategy_id, input_price, average_price, quantity, decision, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.userId,
    input.strategyId,
    input.inputPrice,
    input.averagePrice,
    input.quantity,
    input.decision,
    input.reason
  );
  const row = getDb().prepare('SELECT * FROM decision_logs WHERE id = ?').get(result.lastInsertRowid);
  return toLog(row);
}

function toLog(row) {
  return {
    id: row.id,
    userId: row.user_id,
    strategyId: row.strategy_id,
    inputPrice: row.input_price,
    averagePrice: row.average_price,
    quantity: row.quantity,
    decision: row.decision,
    reason: row.reason,
    createdAt: row.created_at
  };
}
