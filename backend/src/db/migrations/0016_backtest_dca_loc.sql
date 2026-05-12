-- LAOR_INFINITE_V2 알고리즘 메타 컬럼을 포함하도록 backtest_runs를 재생성한다.
-- split_count / buy_amount_per_round는 현재 엔진에서 계속 사용한다.
-- SQLite는 ALTER COLUMN을 지원하지 않으므로 테이블 재생성 트릭을 사용.

CREATE TABLE backtest_runs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  symbol TEXT,
  market TEXT NOT NULL DEFAULT 'US',
  data_source TEXT NOT NULL DEFAULT 'KIS_API',
  currency TEXT NOT NULL DEFAULT 'USD',
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  total_budget REAL NOT NULL CHECK (total_budget > 0),
  split_count INTEGER NOT NULL DEFAULT 0,
  buy_amount_per_round REAL NOT NULL DEFAULT 0,
  initial_lump_ratio REAL NOT NULL DEFAULT 0.5,
  daily_amount REAL NOT NULL DEFAULT 0,
  algorithm TEXT NOT NULL DEFAULT 'LAOR_INFINITE_V2',
  target_profit_rate REAL NOT NULL CHECK (target_profit_rate > 0),
  restart_after_sell INTEGER NOT NULL DEFAULT 0 CHECK (restart_after_sell IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  initial_budget REAL NOT NULL DEFAULT 0,
  final_asset REAL NOT NULL DEFAULT 0,
  realized_profit REAL NOT NULL DEFAULT 0,
  unrealized_profit REAL NOT NULL DEFAULT 0,
  return_rate REAL NOT NULL DEFAULT 0,
  max_invested_amount REAL NOT NULL DEFAULT 0,
  max_drawdown_rate REAL NOT NULL DEFAULT 0,
  total_buy_count INTEGER NOT NULL DEFAULT 0,
  total_sell_count INTEGER NOT NULL DEFAULT 0,
  final_holding_quantity REAL NOT NULL DEFAULT 0,
  final_average_price REAL NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO backtest_runs_new (
  id, user_id, stock_code, stock_name, symbol, market, data_source, currency,
  from_date, to_date, total_budget, split_count, buy_amount_per_round,
  initial_lump_ratio, daily_amount, algorithm, target_profit_rate,
  restart_after_sell, status, initial_budget, final_asset, realized_profit,
  unrealized_profit, return_rate, max_invested_amount, max_drawdown_rate,
  total_buy_count, total_sell_count, final_holding_quantity, final_average_price,
  error_message, created_at, completed_at
)
SELECT
  id, user_id, stock_code, stock_name, symbol, market, data_source, currency,
  from_date, to_date, total_budget,
  COALESCE(split_count, 0),
  COALESCE(buy_amount_per_round, 0),
  COALESCE(initial_lump_ratio, 0.5),
  COALESCE(daily_amount, 0),
  COALESCE(algorithm, 'LAOR_INFINITE_V2'),
  target_profit_rate, restart_after_sell, status, initial_budget, final_asset,
  realized_profit, unrealized_profit, return_rate, max_invested_amount,
  max_drawdown_rate, total_buy_count, total_sell_count, final_holding_quantity,
  final_average_price, error_message, created_at, completed_at
FROM backtest_runs;

DROP TABLE backtest_runs;
ALTER TABLE backtest_runs_new RENAME TO backtest_runs;

CREATE INDEX IF NOT EXISTS idx_backtest_runs_user ON backtest_runs(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_user_stock ON backtest_runs(user_id, stock_code);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_user_symbol
  ON backtest_runs(user_id, market, symbol);
