-- 한국 국장 상승률 랭킹 자동매매 전략(KR_RANK_MOMENTUM).
-- 라오어 무한매수법(auto_trading_*) 테이블과 완전히 분리된 별도 테이블 세트로,
-- 기존 자동매매 테이블은 ALTER하지 않는다. 실주문 실행 설정(user_trading_settings)은
-- 두 전략 종류가 공유한다.

-- 전략 본체. 한 전략은 동시에 한 종목만 보유한다(holding_* 컬럼).
-- 점심 진입을 켜면 오전·점심 두 번 매수할 수 있어, 진입 구간별로 매수 금액·목표 수익률·손절률을
-- 따로 입력받는다(morning_* / lunch_*). 점심 진입이 꺼져 있으면 lunch_* 값은 사용하지 않는다.
CREATE TABLE IF NOT EXISTS kr_rank_strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'RUNNING', 'STOPPED', 'ERROR')),
  morning_budget REAL NOT NULL CHECK (morning_budget > 0),
  lunch_budget REAL NOT NULL DEFAULT 0 CHECK (lunch_budget >= 0),
  morning_target_profit_rate REAL NOT NULL DEFAULT 0.05 CHECK (morning_target_profit_rate > 0),
  morning_stop_loss_rate REAL NOT NULL DEFAULT 0.03 CHECK (morning_stop_loss_rate > 0),
  lunch_entry_enabled INTEGER NOT NULL DEFAULT 0 CHECK (lunch_entry_enabled IN (0, 1)),
  lunch_target_profit_rate REAL NOT NULL DEFAULT 0.03 CHECK (lunch_target_profit_rate > 0),
  lunch_stop_loss_rate REAL NOT NULL DEFAULT 0.03 CHECK (lunch_stop_loss_rate > 0),
  -- 현재 보유 종목. 매수 접수 시 채우고 매도 접수 시 비운다. NULL이면 무보유.
  holding_symbol TEXT,
  holding_symbol_name TEXT,
  holding_entry_window TEXT CHECK (holding_entry_window IN ('MORNING', 'LUNCH')),
  started_at TEXT,
  stopped_at TEXT,
  last_evaluated_at TEXT,
  last_decision TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 일자별·진입 구간별 진입 기록. UNIQUE(strategy_id, trade_date, entry_window)로
-- "하루 1회 · 진입 구간당 1회"를 DB 차원에서 보장한다.
CREATE TABLE IF NOT EXISTS kr_rank_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES kr_rank_strategies(id) ON DELETE CASCADE,
  trade_date TEXT NOT NULL,
  entry_window TEXT NOT NULL CHECK (entry_window IN ('MORNING', 'LUNCH')),
  status TEXT NOT NULL CHECK (status IN ('NO_CANDIDATE', 'SELECTED', 'BOUGHT', 'SKIPPED')),
  selected_symbol TEXT,
  selected_symbol_name TEXT,
  selected_price REAL,
  selected_fluctuation_rate REAL,
  ranking_snapshot TEXT,
  bought INTEGER NOT NULL DEFAULT 0 CHECK (bought IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_id, trade_date, entry_window)
);

-- 주문 라이프사이클. idempotency_key UNIQUE로 같은 (날짜·전략·구간·방향) 중복 주문을 막는다.
CREATE TABLE IF NOT EXISTS kr_rank_orders (
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(idempotency_key)
);

-- 매 평가의 판단 기록. 진입 구간·선택 종목·매도 사유를 구분해 저장한다.
CREATE TABLE IF NOT EXISTS kr_rank_decision_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES kr_rank_strategies(id) ON DELETE CASCADE,
  entry_window TEXT CHECK (entry_window IN ('MORNING', 'LUNCH')),
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'SKIP', 'ERROR')),
  sell_reason TEXT CHECK (sell_reason IN ('TARGET', 'STOP_LOSS')),
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

-- 동시 평가 방지 락.
CREATE TABLE IF NOT EXISTS kr_rank_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES kr_rank_strategies(id) ON DELETE CASCADE,
  lock_key TEXT NOT NULL,
  locked_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_id, lock_key)
);

CREATE INDEX IF NOT EXISTS idx_kr_rank_strategies_user_status
  ON kr_rank_strategies(user_id, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_kr_rank_entries_user_strategy
  ON kr_rank_entries(user_id, strategy_id, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_kr_rank_orders_user_strategy
  ON kr_rank_orders(user_id, strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kr_rank_decision_logs_user_strategy
  ON kr_rank_decision_logs(user_id, strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kr_rank_locks_until
  ON kr_rank_locks(locked_until);
