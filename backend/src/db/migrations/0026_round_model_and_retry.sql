-- 라오어 자동매매 회차 모델 정상화 + 주문 재시도(tick 간 재시도) 지원.
--
-- 1) auto_trading_strategies.round_trade_date — 현재 회차가 진행 중인 거래일.
--    "1 회차 = 1 거래일" 모델에서 회차가 하루에 한 번만 넘어가도록 추적한다.
--
-- 2) auto_trading_orders / kr_rank_orders 의 idempotency_key UNIQUE 제약 제거.
--    실패한 주문을 다음 tick에서 다시 시도하려면 같은 키로 새 주문 행을 만들 수 있어야 한다.
--    중복 주문 방지는 제약이 아니라 코드에서 "같은 키의 FAILED 아닌 주문이 있는가"로 검사한다.
--    SQLite는 제약만 따로 떼지 못하므로 테이블을 재생성한다. migrate.js가 마이그레이션 동안
--    foreign_keys=OFF로 두므로 부모 테이블 교체로 자식 행이 유실되지 않는다.

ALTER TABLE auto_trading_strategies ADD COLUMN round_trade_date TEXT;

-- ── auto_trading_orders 재생성 (UNIQUE(idempotency_key) 제거) ──
CREATE TABLE auto_trading_orders_new (
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
  half TEXT,
  decision_log_id INTEGER REFERENCES auto_trading_decision_logs(id) ON DELETE SET NULL,
  exchange TEXT
);
INSERT INTO auto_trading_orders_new (
  id, user_id, strategy_id, symbol, market, currency, side, quantity, order_price,
  estimated_amount, kis_order_no, kis_original_order_no, status, filled_quantity,
  remaining_quantity, average_filled_price, idempotency_key, decision_reason,
  live_order_enabled, request_payload_masked, response_payload_masked, error_message,
  created_at, updated_at, half, decision_log_id, exchange
)
SELECT
  id, user_id, strategy_id, symbol, market, currency, side, quantity, order_price,
  estimated_amount, kis_order_no, kis_original_order_no, status, filled_quantity,
  remaining_quantity, average_filled_price, idempotency_key, decision_reason,
  live_order_enabled, request_payload_masked, response_payload_masked, error_message,
  created_at, updated_at, half, decision_log_id, exchange
FROM auto_trading_orders;
DROP TABLE auto_trading_orders;
ALTER TABLE auto_trading_orders_new RENAME TO auto_trading_orders;
CREATE INDEX idx_auto_trading_orders_user_strategy ON auto_trading_orders(user_id, strategy_id, created_at DESC);
CREATE INDEX idx_auto_trading_orders_user_status ON auto_trading_orders(user_id, status, created_at DESC);
CREATE INDEX idx_auto_trading_orders_decision_log ON auto_trading_orders(user_id, decision_log_id);
CREATE INDEX idx_auto_trading_orders_idem ON auto_trading_orders(idempotency_key);

-- ── kr_rank_orders 재생성 (UNIQUE(idempotency_key) 제거) ──
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
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS')),
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
INSERT INTO kr_rank_orders_new (
  id, user_id, strategy_id, entry_id, symbol, symbol_name, market, currency, side,
  entry_window, sell_reason, quantity, order_price, estimated_amount, kis_order_no,
  kis_original_order_no, status, filled_quantity, remaining_quantity, average_filled_price,
  idempotency_key, decision_reason, live_order_enabled, request_payload_masked,
  response_payload_masked, error_message, created_at, updated_at
)
SELECT
  id, user_id, strategy_id, entry_id, symbol, symbol_name, market, currency, side,
  entry_window, sell_reason, quantity, order_price, estimated_amount, kis_order_no,
  kis_original_order_no, status, filled_quantity, remaining_quantity, average_filled_price,
  idempotency_key, decision_reason, live_order_enabled, request_payload_masked,
  response_payload_masked, error_message, created_at, updated_at
FROM kr_rank_orders;
DROP TABLE kr_rank_orders;
ALTER TABLE kr_rank_orders_new RENAME TO kr_rank_orders;
CREATE INDEX idx_kr_rank_orders_user_strategy ON kr_rank_orders(user_id, strategy_id, created_at DESC);
CREATE INDEX idx_kr_rank_orders_idem ON kr_rank_orders(idempotency_key);
