CREATE TABLE IF NOT EXISTS backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  total_budget INTEGER NOT NULL CHECK (total_budget > 0),
  split_count INTEGER NOT NULL CHECK (split_count > 0),
  buy_amount_per_round INTEGER NOT NULL CHECK (buy_amount_per_round >= 0),
  target_profit_rate REAL NOT NULL CHECK (target_profit_rate > 0),
  restart_after_sell INTEGER NOT NULL DEFAULT 0 CHECK (restart_after_sell IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  initial_budget INTEGER NOT NULL DEFAULT 0,
  final_asset INTEGER NOT NULL DEFAULT 0,
  realized_profit INTEGER NOT NULL DEFAULT 0,
  unrealized_profit INTEGER NOT NULL DEFAULT 0,
  return_rate REAL NOT NULL DEFAULT 0,
  max_invested_amount INTEGER NOT NULL DEFAULT 0,
  max_drawdown_rate REAL NOT NULL DEFAULT 0,
  total_buy_count INTEGER NOT NULL DEFAULT 0,
  total_sell_count INTEGER NOT NULL DEFAULT 0,
  final_holding_quantity INTEGER NOT NULL DEFAULT 0,
  final_average_price REAL NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_user ON backtest_runs(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_user_stock ON backtest_runs(user_id, stock_code);
