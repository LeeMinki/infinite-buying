-- 한국 국장 상승률 랭킹 전략에 진입 구간별 시각 청산 옵션을 추가한다.
--
-- 1) kr_rank_strategies.morning_liquidate_time / lunch_liquidate_time (TEXT, NULL 허용):
--    'HH:MM' KST 24시간 표기. NULL이면 시각 청산을 쓰지 않고 목표 수익/손절만 적용한다.
--    값이 있으면 그 시각 이후 평가에서 목표·손절 미도달이어도 전량 매도(TIME_LIQUIDATE).
--    보유분이 만들어진 진입 구간(MORNING/LUNCH)에 대응되는 시각을 쓴다.
--
-- 2) kr_rank_orders / kr_rank_decision_logs 의 sell_reason CHECK 제약에 'TIME_LIQUIDATE' 추가.
--    SQLite는 CHECK 제약만 따로 수정하지 못하므로 두 테이블을 재생성한다. migrate.js는
--    마이그레이션 동안 foreign_keys=OFF로 두므로 자식 행이 유실되지 않는다.

ALTER TABLE kr_rank_strategies ADD COLUMN morning_liquidate_time TEXT;
ALTER TABLE kr_rank_strategies ADD COLUMN lunch_liquidate_time TEXT;

-- ── kr_rank_orders 재생성 (sell_reason CHECK 확장) ──
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
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS', 'TIME_LIQUIDATE')),
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

-- ── kr_rank_decision_logs 재생성 (sell_reason CHECK 확장) ──
CREATE TABLE kr_rank_decision_logs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES kr_rank_strategies(id) ON DELETE CASCADE,
  entry_window TEXT CHECK (entry_window IN ('MORNING', 'LUNCH')),
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'SKIP', 'ERROR')),
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS', 'TIME_LIQUIDATE')),
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
INSERT INTO kr_rank_decision_logs_new (
  id, user_id, strategy_id, entry_window, decision, sell_reason,
  selected_symbol, selected_symbol_name, current_price, average_price,
  holding_quantity, cash_available, expected_quantity, expected_price,
  expected_amount, ranking_snapshot, live_order_enabled, evaluation_source,
  order_id, reason, created_at
)
SELECT
  id, user_id, strategy_id, entry_window, decision, sell_reason,
  selected_symbol, selected_symbol_name, current_price, average_price,
  holding_quantity, cash_available, expected_quantity, expected_price,
  expected_amount, ranking_snapshot, live_order_enabled, evaluation_source,
  order_id, reason, created_at
FROM kr_rank_decision_logs;
DROP TABLE kr_rank_decision_logs;
ALTER TABLE kr_rank_decision_logs_new RENAME TO kr_rank_decision_logs;
CREATE INDEX idx_kr_rank_decision_logs_user_strategy
  ON kr_rank_decision_logs(user_id, strategy_id, created_at DESC);
