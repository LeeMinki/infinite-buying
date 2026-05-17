-- 스키마 드리프트 정정.
-- 0020_big_buy_premium_rate.sql 가 적용된 뒤 파일 내용이 nullable 로 수정됐지만,
-- 마이그레이션 러너는 파일명으로만 적용 여부를 추적하므로 이미 적용된 DB 에는
-- big_buy_premium_rate 가 옛 정의(NOT NULL DEFAULT 0.1)로 남아 있다.
-- 그 결과 큰수 매수 여유율을 비워(NULL = 자동 계산) 저장하면 NOT NULL 제약에 걸린다.
-- 또한 아카이브된 change-buy-algorithm 의 0020_max_buy_above_average_rate.sql 가
-- 남긴 max_buy_above_average_rate(및 옛 strategies.mode) 유령 컬럼도 함께 제거한다.
--
-- SQLite 는 컬럼 제약 변경/삭제를 ALTER 로 못 하므로 테이블을 재생성한다.
-- 러너가 마이그레이션 동안 FK 강제를 끄므로 부모 테이블 DROP 시 자식이 CASCADE 되지 않는다.
-- 이미 올바른 스키마인 신규 DB 에서는 동일 스키마로 재생성될 뿐이라 무해하다.

-- backtest_runs ---------------------------------------------------------------
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
  big_buy_premium_rate REAL CHECK (big_buy_premium_rate IS NULL OR big_buy_premium_rate >= 0),
  allow_fractional_shares INTEGER NOT NULL DEFAULT 0 CHECK (allow_fractional_shares IN (0, 1)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO backtest_runs_new (
  id, user_id, stock_code, stock_name, symbol, market, data_source, currency,
  from_date, to_date, total_budget, split_count, buy_amount_per_round,
  initial_lump_ratio, daily_amount, algorithm, target_profit_rate,
  restart_after_sell, status, initial_budget, final_asset, realized_profit,
  unrealized_profit, return_rate, max_invested_amount, max_drawdown_rate,
  total_buy_count, total_sell_count, final_holding_quantity, final_average_price,
  error_message, created_at, completed_at, big_buy_premium_rate, allow_fractional_shares
)
SELECT
  id, user_id, stock_code, stock_name, symbol, market, data_source, currency,
  from_date, to_date, total_budget, split_count, buy_amount_per_round,
  initial_lump_ratio, daily_amount, algorithm, target_profit_rate,
  restart_after_sell, status, initial_budget, final_asset, realized_profit,
  unrealized_profit, return_rate, max_invested_amount, max_drawdown_rate,
  total_buy_count, total_sell_count, final_holding_quantity, final_average_price,
  error_message, created_at, completed_at, big_buy_premium_rate, allow_fractional_shares
FROM backtest_runs;

DROP TABLE backtest_runs;
ALTER TABLE backtest_runs_new RENAME TO backtest_runs;

CREATE INDEX IF NOT EXISTS idx_backtest_runs_user ON backtest_runs(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_user_stock ON backtest_runs(user_id, stock_code);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_user_symbol ON backtest_runs(user_id, market, symbol);

-- strategies ------------------------------------------------------------------
CREATE TABLE strategies_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  total_budget INTEGER NOT NULL CHECK (total_budget > 0),
  split_count INTEGER NOT NULL DEFAULT 40 CHECK (split_count > 0),
  buy_amount_per_round INTEGER NOT NULL CHECK (buy_amount_per_round >= 0),
  target_profit_rate REAL NOT NULL DEFAULT 0.10 CHECK (target_profit_rate > 0),
  current_round INTEGER NOT NULL DEFAULT 1 CHECK (current_round > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id),
  big_buy_premium_rate REAL CHECK (big_buy_premium_rate IS NULL OR big_buy_premium_rate >= 0)
);

INSERT INTO strategies_new (
  id, name, stock_code, stock_name, total_budget, split_count,
  buy_amount_per_round, target_profit_rate, current_round, status,
  created_at, updated_at, user_id, big_buy_premium_rate
)
SELECT
  id, name, stock_code, stock_name, total_budget, split_count,
  buy_amount_per_round, target_profit_rate, current_round, status,
  created_at, updated_at, user_id, big_buy_premium_rate
FROM strategies;

DROP TABLE strategies;
ALTER TABLE strategies_new RENAME TO strategies;

CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id, id);

-- auto_trading_strategies -----------------------------------------------------
CREATE TABLE auto_trading_strategies_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  symbol_name TEXT,
  market TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'RUNNING', 'STOPPED', 'ERROR')),
  total_budget REAL NOT NULL CHECK (total_budget > 0),
  split_count INTEGER NOT NULL DEFAULT 40 CHECK (split_count > 0),
  buy_amount_per_round REAL NOT NULL CHECK (buy_amount_per_round >= 0),
  target_profit_rate REAL NOT NULL DEFAULT 0.1 CHECK (target_profit_rate > 0),
  current_round INTEGER NOT NULL DEFAULT 0 CHECK (current_round >= 0),
  max_order_amount REAL NOT NULL DEFAULT 0 CHECK (max_order_amount >= 0),
  max_daily_order_amount REAL NOT NULL DEFAULT 0 CHECK (max_daily_order_amount >= 0),
  started_at TEXT,
  stopped_at TEXT,
  last_evaluated_at TEXT,
  last_order_at TEXT,
  last_decision TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  big_buy_premium_rate REAL CHECK (big_buy_premium_rate IS NULL OR big_buy_premium_rate >= 0),
  pending_avg_budget REAL NOT NULL DEFAULT 0 CHECK (pending_avg_budget >= 0),
  pending_big_budget REAL NOT NULL DEFAULT 0 CHECK (pending_big_budget >= 0),
  cycle_budget REAL NOT NULL DEFAULT 0 CHECK (cycle_budget >= 0)
);

INSERT INTO auto_trading_strategies_new (
  id, user_id, symbol, symbol_name, market, currency, status, total_budget,
  split_count, buy_amount_per_round, target_profit_rate, current_round,
  max_order_amount, max_daily_order_amount, started_at, stopped_at,
  last_evaluated_at, last_order_at, last_decision, last_error_message,
  created_at, updated_at, big_buy_premium_rate, pending_avg_budget,
  pending_big_budget, cycle_budget
)
SELECT
  id, user_id, symbol, symbol_name, market, currency, status, total_budget,
  split_count, buy_amount_per_round, target_profit_rate, current_round,
  max_order_amount, max_daily_order_amount, started_at, stopped_at,
  last_evaluated_at, last_order_at, last_decision, last_error_message,
  created_at, updated_at, big_buy_premium_rate, pending_avg_budget,
  pending_big_budget, cycle_budget
FROM auto_trading_strategies;

DROP TABLE auto_trading_strategies;
ALTER TABLE auto_trading_strategies_new RENAME TO auto_trading_strategies;

CREATE INDEX IF NOT EXISTS idx_auto_trading_strategies_user_status
  ON auto_trading_strategies(user_id, status, id DESC);
