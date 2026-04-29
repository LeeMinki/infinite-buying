import { getDb } from '../db/connection.js';

export function upsertDailyPrices(userId, rows) {
  const stmt = getDb().prepare(`
    INSERT INTO market_price_cache (user_id, stock_code, date, open, high, low, close, volume, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, stock_code, date) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      source = excluded.source,
      updated_at = datetime('now')
  `);
  rows.forEach((row) => {
    stmt.run(userId, row.stockCode, row.date, row.open, row.high, row.low, row.close, row.volume, row.source || 'KIWOOM');
  });
}

export function listDailyPrices(userId, stockCode, { from, to } = {}) {
  const clauses = ['user_id = ?', 'stock_code = ?'];
  const params = [userId, stockCode];
  if (from) {
    clauses.push('date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('date <= ?');
    params.push(to);
  }
  return getDb().prepare(`
    SELECT * FROM market_price_cache
    WHERE ${clauses.join(' AND ')}
    ORDER BY date ASC
  `).all(...params).map(toDailyPrice);
}

function toDailyPrice(row) {
  return {
    stockCode: row.stock_code,
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    source: row.source
  };
}
