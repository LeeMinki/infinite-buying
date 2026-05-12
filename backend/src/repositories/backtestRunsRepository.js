import { getDb } from '../db/connection.js';

function toRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol || row.stock_code,
    market: row.market || 'US',
    currency: row.currency || 'USD',
    dataSource: row.data_source || 'KIS_API',
    fromDate: row.from_date,
    toDate: row.to_date,
    totalBudget: row.total_budget,
    splitCount: row.split_count,
    buyAmountPerRound: row.buy_amount_per_round,
    initialLumpRatio: row.initial_lump_ratio,
    dailyAmount: row.daily_amount,
    algorithm: row.algorithm || 'LAOR_INFINITE_V2',
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

function safeFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeNonNegInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.max(0, Math.floor(n));
}

export function createRun(userId, input) {
  const totalBudget = safeFiniteNumber(input.totalBudget, 0);
  const targetProfitRate = safeFiniteNumber(input.targetProfitRate, 0.1);
  const splitCountRaw = Number(input.splitCount);
  const splitCount = Number.isInteger(splitCountRaw) && splitCountRaw > 0
    ? splitCountRaw
    : 40;
  const perRoundBudget = splitCount > 0 ? totalBudget / splitCount : 0;
  const market = String(input.market || 'US').toUpperCase();
  const currency = String(input.currency || (market === 'KR' ? 'KRW' : 'USD')).toUpperCase();
  const result = getDb()
    .prepare(`
      INSERT INTO backtest_runs (
        user_id, stock_code, stock_name, symbol, market, data_source, currency, from_date, to_date,
        total_budget, split_count, buy_amount_per_round, target_profit_rate, restart_after_sell,
        initial_lump_ratio, daily_amount, algorithm,
        status, initial_budget
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)
    `)
    .run(
      userId,
      input.symbol,
      input.symbol,
      input.symbol,
      market,
      'KIS_API',
      currency,
      input.fromDate,
      input.toDate,
      totalBudget,
      splitCount,
      perRoundBudget,
      targetProfitRate,
      input.restartAfterSell ? 1 : 0,
      0,
      0,
      'LAOR_INFINITE_V2',
      totalBudget
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
