-- 랭킹 전략의 진입 실패 조기 매도 사유를 저장한다.
-- 목표가 주문은 기존 sell_reason='TARGET' 주문 행으로 추적하고, 진입 실패 매도는
-- ENTRY_FAILED로 일반 손절/청산과 구분한다.

CREATE TABLE kr_rank_orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES kr_rank_strategies(id) ON DELETE CASCADE,
  entry_id INTEGER REFERENCES kr_rank_entries(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  symbol_name TEXT,
  market TEXT NOT NULL DEFAULT 'KR',
  currency TEXT NOT NULL DEFAULT 'KRW',
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  entry_window TEXT NOT NULL CHECK (entry_window IN ('MORNING', 'LUNCH')),
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS', 'TIME_LIQUIDATE', 'ENTRY_FAILED')),
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
INSERT INTO kr_rank_orders_new SELECT * FROM kr_rank_orders;
DROP TABLE kr_rank_orders;
ALTER TABLE kr_rank_orders_new RENAME TO kr_rank_orders;
CREATE INDEX IF NOT EXISTS idx_kr_rank_orders_user_strategy
  ON kr_rank_orders(user_id, strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kr_rank_orders_idem
  ON kr_rank_orders(idempotency_key);

CREATE TABLE kr_rank_decision_logs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES kr_rank_strategies(id) ON DELETE CASCADE,
  entry_window TEXT CHECK (entry_window IN ('MORNING', 'LUNCH')),
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'SKIP', 'ERROR')),
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS', 'TIME_LIQUIDATE', 'ENTRY_FAILED')),
  selected_symbol TEXT,
  selected_symbol_name TEXT,
  current_price REAL NOT NULL DEFAULT 0,
  average_price REAL NOT NULL DEFAULT 0,
  holding_quantity REAL NOT NULL DEFAULT 0,
  cash_available REAL,
  expected_quantity REAL,
  expected_price REAL,
  expected_amount REAL,
  ranking_snapshot TEXT,
  live_order_enabled INTEGER NOT NULL CHECK (live_order_enabled IN (0, 1)),
  evaluation_source TEXT NOT NULL DEFAULT 'SCHEDULED',
  order_id INTEGER,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO kr_rank_decision_logs_new SELECT * FROM kr_rank_decision_logs;
DROP TABLE kr_rank_decision_logs;
ALTER TABLE kr_rank_decision_logs_new RENAME TO kr_rank_decision_logs;
CREATE INDEX IF NOT EXISTS idx_kr_rank_decision_logs_user_strategy
  ON kr_rank_decision_logs(user_id, strategy_id, created_at DESC);

CREATE TABLE us_rank_trades_new (
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
  exit_reason TEXT CHECK (exit_reason IN ('TARGET', 'STOP_LOSS', 'FORCE_CLOSE', 'CYCLE_COMPLETE', 'ENTRY_FAILED')),
  profit_rate REAL,
  status TEXT NOT NULL DEFAULT 'SELECTED' CHECK (status IN ('SELECTED', 'BOUGHT', 'CLOSED', 'FAILED', 'NO_CANDIDATE')),
  error_message TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_id, trade_date, trade_seq)
);
INSERT INTO us_rank_trades_new SELECT * FROM us_rank_trades;
DROP TABLE us_rank_trades;
ALTER TABLE us_rank_trades_new RENAME TO us_rank_trades;
CREATE INDEX IF NOT EXISTS idx_us_rank_trades_user_strategy
  ON us_rank_trades(user_id, strategy_id, trade_date DESC, trade_seq DESC);

CREATE TABLE us_rank_orders_new (
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
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS', 'FORCE_CLOSE', 'CYCLE_COMPLETE', 'ENTRY_FAILED')),
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
INSERT INTO us_rank_orders_new SELECT * FROM us_rank_orders;
DROP TABLE us_rank_orders;
ALTER TABLE us_rank_orders_new RENAME TO us_rank_orders;
CREATE INDEX IF NOT EXISTS idx_us_rank_orders_user_strategy
  ON us_rank_orders(user_id, strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_us_rank_orders_idem
  ON us_rank_orders(idempotency_key);

CREATE TABLE us_rank_decision_logs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES us_rank_strategies(id) ON DELETE CASCADE,
  trade_id INTEGER REFERENCES us_rank_trades(id) ON DELETE SET NULL,
  trade_date TEXT,
  trade_seq INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'SKIP', 'ERROR')),
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS', 'FORCE_CLOSE', 'CYCLE_COMPLETE', 'ENTRY_FAILED')),
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
INSERT INTO us_rank_decision_logs_new SELECT * FROM us_rank_decision_logs;
DROP TABLE us_rank_decision_logs;
ALTER TABLE us_rank_decision_logs_new RENAME TO us_rank_decision_logs;
CREATE INDEX IF NOT EXISTS idx_us_rank_decision_logs_user_strategy
  ON us_rank_decision_logs(user_id, strategy_id, created_at DESC);
