import { getDb } from '../db/connection.js';

export function upsertDailyPrices(userId, rows) {
  const stmt = getDb().prepare(`
    INSERT INTO market_price_cache (
      user_id, symbol, market, exchange, date, open, high, low, close, volume, currency, source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, market, symbol, date) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      exchange = excluded.exchange,
      currency = excluded.currency,
      source = excluded.source,
      updated_at = datetime('now')
  `);
  rows.forEach((row) => {
    stmt.run(
      userId,
      normalizeSymbol(row.symbol || row.stockCode),
      row.market || 'US',
      row.exchange || null,
      row.date,
      row.open,
      row.high,
      row.low,
      row.close,
      row.volume || 0,
      row.currency || 'USD',
      row.source || 'KIS_API'
    );
  });
}

export function listDailyPrices(userId, symbol, { from, to, market = 'US' } = {}) {
  const clauses = ['user_id = ?', 'market = ?', 'symbol = ?'];
  const params = [userId, market, normalizeSymbol(symbol)];
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
    symbol: row.symbol,
    market: row.market,
    exchange: row.exchange,
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    currency: row.currency,
    source: row.source
  };
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}
