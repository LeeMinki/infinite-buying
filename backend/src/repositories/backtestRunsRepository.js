import { getDb } from '../db/connection.js';

function toRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    fromDate: row.from_date,
    toDate: row.to_date,
    totalBudget: row.total_budget,
    splitCount: row.split_count,
    buyAmountPerRound: row.buy_amount_per_round,
    targetProfitRate: row.target_profit_rate,
    restartAfterSell: row.restart_after_sell === 1,
    status: row.status,
    initialBudget: row.initial_budget,
    finalAsset: row.final_asset,
    realizedProfit: row.realized_profit,
    unrealizedProfit: row.unrealized_profit,
    returnRate: row.return_rate,
    maxInvestedAmount: row.max_invested_amount,
    maxDrawdownRate: row.max_drawdown_rate,
    totalBuyCount: row.total_buy_count,
    totalSellCount: row.total_sell_count,
    finalHoldingQuantity: row.final_holding_quantity,
    finalAveragePrice: row.final_average_price,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

export function listRuns(userId) {
  return getDb()
    .prepare('SELECT * FROM backtest_runs WHERE user_id = ? ORDER BY id DESC')
    .all(userId)
    .map(toRun);
}

export function getRun(userId, id) {
  const row = getDb()
    .prepare('SELECT * FROM backtest_runs WHERE user_id = ? AND id = ?')
    .get(userId, id);
  return toRun(row);
}

export function createRun(userId, input) {
  const buyAmountPerRound = Math.floor(input.totalBudget / input.splitCount);
  const result = getDb()
    .prepare(`
      INSERT INTO backtest_runs (
        user_id, stock_code, stock_name, from_date, to_date,
        total_budget, split_count, buy_amount_per_round, target_profit_rate, restart_after_sell,
        status, initial_budget
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)
    `)
    .run(
      userId,
      input.stockCode,
      input.stockName ?? null,
      input.fromDate,
      input.toDate,
      input.totalBudget,
      input.splitCount,
      buyAmountPerRound,
      input.targetProfitRate,
      input.restartAfterSell ? 1 : 0,
      input.totalBudget
    );
  return getRun(userId, result.lastInsertRowid);
}

export function completeRun(userId, id, summary) {
  getDb()
    .prepare(`
      UPDATE backtest_runs SET
        status = 'COMPLETED',
        final_asset = ?,
        realized_profit = ?,
        unrealized_profit = ?,
        return_rate = ?,
        max_invested_amount = ?,
        max_drawdown_rate = ?,
        total_buy_count = ?,
        total_sell_count = ?,
        final_holding_quantity = ?,
        final_average_price = ?,
        completed_at = datetime('now')
      WHERE user_id = ? AND id = ?
    `)
    .run(
      summary.finalAsset,
      summary.realizedProfit,
      summary.unrealizedProfit,
      summary.returnRate,
      summary.maxInvestedAmount,
      summary.maxDrawdownRate,
      summary.totalBuyCount,
      summary.totalSellCount,
      summary.finalHoldingQuantity,
      summary.finalAveragePrice,
      userId,
      id
    );
  return getRun(userId, id);
}

export function failRun(userId, id, errorMessage) {
  getDb()
    .prepare(`
      UPDATE backtest_runs SET
        status = 'FAILED',
        error_message = ?,
        completed_at = datetime('now')
      WHERE user_id = ? AND id = ?
    `)
    .run(errorMessage, userId, id);
  return getRun(userId, id);
}

export function deleteRun(userId, id) {
  return getDb()
    .prepare('DELETE FROM backtest_runs WHERE user_id = ? AND id = ?')
    .run(userId, id).changes > 0;
}
