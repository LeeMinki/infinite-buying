CREATE TABLE IF NOT EXISTS user_trading_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  live_order_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_order_enabled IN (0, 1)),
  live_order_enabled_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_trading_setting_histories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_live_order_enabled INTEGER NOT NULL CHECK (previous_live_order_enabled IN (0, 1)),
  new_live_order_enabled INTEGER NOT NULL CHECK (new_live_order_enabled IN (0, 1)),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auto_trading_strategies (
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auto_trading_position_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES auto_trading_strategies(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  currency TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  average_price REAL NOT NULL DEFAULT 0 CHECK (average_price >= 0),
  current_price REAL NOT NULL DEFAULT 0 CHECK (current_price >= 0),
  evaluation_amount REAL NOT NULL DEFAULT 0,
  unrealized_profit REAL NOT NULL DEFAULT 0,
  unrealized_profit_rate REAL NOT NULL DEFAULT 0,
  cash_available REAL,
  source TEXT NOT NULL DEFAULT 'KIS',
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auto_trading_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES auto_trading_strategies(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  currency TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(idempotency_key)
);

CREATE TABLE IF NOT EXISTS auto_trading_decision_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES auto_trading_strategies(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  currency TEXT NOT NULL,
  current_price REAL NOT NULL DEFAULT 0,
  average_price REAL NOT NULL DEFAULT 0,
  holding_quantity REAL NOT NULL DEFAULT 0,
  cash_available REAL,
  current_round INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'SKIP', 'ERROR')),
  expected_quantity REAL,
  expected_order_price REAL,
  expected_amount REAL,
  live_order_enabled INTEGER NOT NULL CHECK (live_order_enabled IN (0, 1)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auto_trading_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES auto_trading_strategies(id) ON DELETE CASCADE,
  lock_key TEXT NOT NULL,
  locked_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_id, lock_key)
);

CREATE TABLE IF NOT EXISTS daily_order_limit_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES auto_trading_strategies(id) ON DELETE CASCADE,
  trade_date TEXT NOT NULL,
  market TEXT NOT NULL,
  currency TEXT NOT NULL,
  used_amount REAL NOT NULL DEFAULT 0 CHECK (used_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, strategy_id, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_user_trading_setting_histories_user
  ON user_trading_setting_histories(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_trading_strategies_user_status
  ON auto_trading_strategies(user_id, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_auto_trading_position_snapshots_user_strategy
  ON auto_trading_position_snapshots(user_id, strategy_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_trading_orders_user_strategy
  ON auto_trading_orders(user_id, strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_trading_orders_user_status
  ON auto_trading_orders(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_trading_decision_logs_user_strategy
  ON auto_trading_decision_logs(user_id, strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_trading_locks_until
  ON auto_trading_locks(locked_until);
CREATE INDEX IF NOT EXISTS idx_daily_order_limit_usages_user_strategy_date
  ON daily_order_limit_usages(user_id, strategy_id, trade_date);
