import { getDb } from '../db/connection.js';

function toTrade(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    runId: row.run_id,
    tradeDate: row.trade_date,
    side: row.side,
    price: row.price,
    quantity: row.quantity,
    amount: row.amount,
    roundNo: row.round_no,
    cash: row.cash,
    holdingQuantity: row.holding_quantity,
    averagePrice: row.average_price,
    investedAmount: row.invested_amount,
    realizedProfit: row.realized_profit,
    unrealizedProfit: row.unrealized_profit,
    evaluationAmount: row.evaluation_amount,
    totalAsset: row.total_asset,
    drawdownRate: row.drawdown_rate,
    reason: row.reason,
    createdAt: row.created_at
  };
}

export function listTrades(userId, runId) {
  return getDb()
    .prepare('SELECT * FROM backtest_trades WHERE user_id = ? AND run_id = ? ORDER BY trade_date ASC, id ASC')
    .all(userId, runId)
    .map(toTrade);
}

export function bulkInsert(userId, runId, trades) {
  const stmt = getDb().prepare(`
    INSERT INTO backtest_trades (
      user_id, run_id, trade_date, side, price, quantity, amount, round_no,
      cash, holding_quantity, average_price, invested_amount,
      realized_profit, unrealized_profit, evaluation_amount, total_asset,
      drawdown_rate, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = getDb().transaction((rows) => {
    for (const t of rows) {
      stmt.run(
        userId,
        runId,
        t.tradeDate,
        t.side,
        t.price,
        t.quantity,
        t.amount,
        t.roundNo,
        t.cash,
        t.holdingQuantity,
        t.averagePrice,
        t.investedAmount,
        t.realizedProfit,
        t.unrealizedProfit,
        t.evaluationAmount,
        t.totalAsset,
        t.drawdownRate,
        t.reason ?? ''
      );
    }
  });
  insertMany(trades);
}
