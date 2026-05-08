CREATE TABLE IF NOT EXISTS backtest_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  run_id INTEGER NOT NULL,
  trade_date TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL', 'HOLD', 'COMPLETED')),
  price REAL NOT NULL CHECK (price >= 0),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  round_no INTEGER NOT NULL DEFAULT 1 CHECK (round_no > 0),
  cash INTEGER NOT NULL DEFAULT 0,
  holding_quantity INTEGER NOT NULL DEFAULT 0,
  average_price REAL NOT NULL DEFAULT 0,
  invested_amount INTEGER NOT NULL DEFAULT 0,
  realized_profit INTEGER NOT NULL DEFAULT 0,
  unrealized_profit INTEGER NOT NULL DEFAULT 0,
  evaluation_amount INTEGER NOT NULL DEFAULT 0,
  total_asset INTEGER NOT NULL DEFAULT 0,
  drawdown_rate REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_user_run_date ON backtest_trades(user_id, run_id, trade_date);
