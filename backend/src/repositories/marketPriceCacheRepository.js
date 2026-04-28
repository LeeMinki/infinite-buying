import { getDb } from '../db/connection.js';

export function upsertDailyPrices(rows) {
  const stmt = getDb().prepare(`
    INSERT INTO market_price_cache (stock_code, date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stock_code, date) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume
  `);
  rows.forEach((row) => {
    stmt.run(row.stockCode, row.date, row.open, row.high, row.low, row.close, row.volume);
  });
}
