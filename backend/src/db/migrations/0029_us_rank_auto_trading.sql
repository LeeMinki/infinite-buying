-- 미국 국장 상승률 랭킹 자동매매 전략(US_RANK_MOMENTUM).
-- 기존 라오어(auto_trading_*)·한국 랭킹(kr_rank_*) 테이블은 변경하지 않고,
-- 미국 랭킹 전용 테이블 세트를 별도로 둔다.

CREATE TABLE IF NOT EXISTS us_rank_strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'RUNNING', 'STOPPED', 'ERROR')),
  auto_budget_enabled INTEGER NOT NULL DEFAULT 1 CHECK (auto_budget_enabled IN (0, 1)),
  fixed_buy_usd_amount REAL NOT NULL DEFAULT 0 CHECK (fixed_buy_usd_amount >= 0),
  target_profit_rate REAL NOT NULL DEFAULT 0.02 CHECK (target_profit_rate > 0),
  stop_loss_rate REAL NOT NULL DEFAULT 0.05 CHECK (stop_loss_rate > 0),
  max_fluctuation_rate REAL NOT NULL DEFAULT 0.20 CHECK (max_fluctuation_rate > 0),
  force_close_kst TEXT NOT NULL DEFAULT '04:30',
  exchange TEXT NOT NULL DEFAULT 'NAS' CHECK (exchange IN ('ALL', 'NAS', 'NYS', 'AMS')),
  currency TEXT NOT NULL DEFAULT 'USD',
  holding_symbol TEXT,
  holding_symbol_name TEXT,
  holding_exchange TEXT,
  holding_quantity REAL NOT NULL DEFAULT 0 CHECK (holding_quantity >= 0),
  holding_average_price REAL NOT NULL DEFAULT 0 CHECK (holding_average_price >= 0),
  day_locked_out INTEGER NOT NULL DEFAULT 0 CHECK (day_locked_out IN (0, 1)),
  day_locked_out_at TEXT,
  day_lock_reason TEXT CHECK (day_lock_reason IN ('STOP_LOSS', 'FORCE_CLOSE')),
  started_at TEXT,
  stopped_at TEXT,
  last_evaluated_at TEXT,
  last_decision TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (auto_budget_enabled = 1 OR fixed_buy_usd_amount > 0)
);

CREATE TABLE IF NOT EXISTS us_rank_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES us_rank_strategies(id) ON DELETE CASCADE,
  trade_date TEXT NOT NULL,
  trade_seq INTEGER NOT NULL CHECK (trade_seq > 0),
  symbol TEXT,
  symbol_name TEXT,
  exchange TEXT,
  selected_price REAL,
  selected_fluctuation_rate REAL,
  ranking_snapshot TEXT,
  entry_price REAL,
  entry_quantity REAL,
  exit_price REAL,
  exit_reason TEXT CHECK (exit_reason IN ('TARGET', 'STOP_LOSS', 'FORCE_CLOSE')),
  profit_rate REAL,
  status TEXT NOT NULL DEFAULT 'SELECTED' CHECK (status IN ('SELECTED', 'BOUGHT', 'CLOSED', 'FAILED', 'NO_CANDIDATE')),
  error_message TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_id, trade_date, trade_seq)
);

CREATE TABLE IF NOT EXISTS us_rank_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES us_rank_strategies(id) ON DELETE CASCADE,
  trade_id INTEGER REFERENCES us_rank_trades(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  symbol_name TEXT,
  market TEXT NOT NULL DEFAULT 'US',
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange TEXT,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS', 'FORCE_CLOSE')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  order_price REAL NOT NULL CHECK (order_price > 0),
  estimated_amount REAL NOT NULL CHECK (estimated_amount >= 0),
  kis_order_no TEXT,
  kis_original_order_no TEXT,
  status TEXT NOT NULL CHECK (status IN ('DECIDED', 'DRY_RUN', 'REQUESTED', 'ACCEPTED', 'REJECTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'FAILED', 'UNKNOWN')),
  filled_quantity REAL,
  remaining_quantity REAL,
  average_filled_price REAL,
  idempotency_key TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  live_order_enabled INTEGER NOT NULL CHECK (live_order_enabled IN (0, 1)),
  request_payload_masked TEXT,
  response_payload_masked TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS us_rank_decision_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES us_rank_strategies(id) ON DELETE CASCADE,
  trade_id INTEGER REFERENCES us_rank_trades(id) ON DELETE SET NULL,
  trade_date TEXT,
  trade_seq INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'SKIP', 'ERROR')),
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS', 'FORCE_CLOSE')),
  selected_symbol TEXT,
  selected_symbol_name TEXT,
  selected_exchange TEXT,
  current_price REAL NOT NULL DEFAULT 0,
  average_price REAL NOT NULL DEFAULT 0,
  holding_quantity REAL NOT NULL DEFAULT 0,
  cash_available REAL,
  expected_quantity REAL,
  expected_price REAL,
  expected_amount REAL,
  profit_rate REAL,
  ranking_snapshot TEXT,
  live_order_enabled INTEGER NOT NULL CHECK (live_order_enabled IN (0, 1)),
  evaluation_source TEXT NOT NULL DEFAULT 'SCHEDULED',
  order_id INTEGER,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS us_rank_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES us_rank_strategies(id) ON DELETE CASCADE,
  lock_key TEXT NOT NULL,
  locked_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_id, lock_key)
);

CREATE INDEX IF NOT EXISTS idx_us_rank_strategies_user_status
  ON us_rank_strategies(user_id, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_us_rank_trades_user_strategy
  ON us_rank_trades(user_id, strategy_id, trade_date DESC, trade_seq DESC);
CREATE INDEX IF NOT EXISTS idx_us_rank_orders_user_strategy
  ON us_rank_orders(user_id, strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_us_rank_orders_idem
  ON us_rank_orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_us_rank_decision_logs_user_strategy
  ON us_rank_decision_logs(user_id, strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_us_rank_locks_until
  ON us_rank_locks(locked_until);
