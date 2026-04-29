DROP TABLE IF EXISTS market_price_cache;

CREATE TABLE market_price_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  stock_code TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'KIWOOM',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, stock_code, date)
);

CREATE INDEX IF NOT EXISTS idx_market_price_cache_user_stock_date
ON market_price_cache(user_id, stock_code, date);
