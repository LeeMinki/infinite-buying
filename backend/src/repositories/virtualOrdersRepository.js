import { getDb } from '../db/connection.js';

export function listOrders(strategyId) {
  return getDb().prepare(`
    SELECT * FROM virtual_orders
    WHERE strategy_id = ?
    ORDER BY id DESC
  `).all(strategyId).map(toOrder);
}

export function getOrder(id) {
  const row = getDb().prepare('SELECT * FROM virtual_orders WHERE id = ?').get(id);
  return row ? toOrder(row) : null;
}

export function findBuy(strategyId, orderDate, roundNo) {
  const row = getDb().prepare(`
    SELECT * FROM virtual_orders
    WHERE strategy_id = ? AND order_date = ? AND round_no = ? AND side = 'BUY'
  `).get(strategyId, orderDate, roundNo);
  return row ? toOrder(row) : null;
}

export function createVirtualOrder(input) {
  const result = getDb().prepare(`
    INSERT INTO virtual_orders (
      strategy_id, order_date, side, price, quantity, amount, status, round_no, reason
    ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `).run(
    input.strategyId,
    input.orderDate,
    input.side,
    input.price,
    input.quantity,
    input.amount,
    input.roundNo,
    input.reason
  );
  return getOrder(result.lastInsertRowid);
}

export function markFilled(id) {
  getDb().prepare(`
    UPDATE virtual_orders
    SET status = 'FILLED', filled_at = datetime('now')
    WHERE id = ? AND status = 'PENDING'
  `).run(id);
  return getOrder(id);
}

export function markCanceled(id) {
  getDb().prepare(`
    UPDATE virtual_orders
    SET status = 'CANCELED'
    WHERE id = ? AND status = 'PENDING'
  `).run(id);
  return getOrder(id);
}

function toOrder(row) {
  return {
    id: row.id,
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
