import { getDb } from '../db/connection.js';

export function listOrders(userId, strategyId) {
  return getDb().prepare(`
    SELECT * FROM virtual_orders
    WHERE user_id = ? AND strategy_id = ?
    ORDER BY id DESC
  `).all(userId, strategyId).map(toOrder);
}

export function getOrder(userId, id) {
  const row = getDb().prepare('SELECT * FROM virtual_orders WHERE user_id = ? AND id = ?').get(userId, id);
  return row ? toOrder(row) : null;
}

export function findBuy(userId, strategyId, orderDate, roundNo) {
  const row = getDb().prepare(`
    SELECT * FROM virtual_orders
    WHERE user_id = ? AND strategy_id = ? AND order_date = ? AND round_no = ? AND side = 'BUY'
  `).get(userId, strategyId, orderDate, roundNo);
  return row ? toOrder(row) : null;
}

export function createVirtualOrder(input) {
  const result = getDb().prepare(`
    INSERT INTO virtual_orders (
      user_id, strategy_id, order_date, side, price, quantity, amount, status, round_no, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `).run(
    input.userId,
    input.strategyId,
    input.orderDate,
    input.side,
    input.price,
    input.quantity,
    input.amount,
    input.roundNo,
    input.reason
  );
  return getOrder(input.userId, result.lastInsertRowid);
}

export function markFilled(userId, id) {
  getDb().prepare(`
    UPDATE virtual_orders
    SET status = 'FILLED', filled_at = datetime('now')
    WHERE user_id = ? AND id = ? AND status = 'PENDING'
  `).run(userId, id);
  return getOrder(userId, id);
}

export function markCanceled(userId, id) {
  getDb().prepare(`
    UPDATE virtual_orders
    SET status = 'CANCELED'
    WHERE user_id = ? AND id = ? AND status = 'PENDING'
  `).run(userId, id);
  return getOrder(userId, id);
}

function toOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    strategyId: row.strategy_id,
    orderDate: row.order_date,
    side: row.side,
    price: row.price,
    quantity: row.quantity,
    amount: row.amount,
    status: row.status,
    roundNo: row.round_no,
    reason: row.reason,
    createdAt: row.created_at,
    filledAt: row.filled_at
  };
}
