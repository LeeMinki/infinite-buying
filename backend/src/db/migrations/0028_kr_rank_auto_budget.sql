-- 한국 국장 상승률 랭킹 전략에 "전 재산 자동 매수" 옵션을 추가한다.
--
-- 1) auto_budget_enabled = 1 이면 평가 시점의 KIS 매수가능금액을 그대로 매수 한도로 쓴다.
--    morning_budget / lunch_budget 컬럼은 이 옵션이 켜진 전략에서 사용되지 않으며 0으로 저장된다.
--    따라서 두 컬럼의 > 0 CHECK 제약을 >= 0 으로 완화한다.
--
-- 2) SQLite는 CHECK 제약만 따로 변경하지 못하므로 kr_rank_strategies 테이블을 재생성한다.
--    migrate.js가 마이그레이션 동안 foreign_keys=OFF로 두어 자식(kr_rank_entries 등) 행이
--    유실되지 않는다.

CREATE TABLE kr_rank_strategies_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'RUNNING', 'STOPPED', 'ERROR')),
  morning_budget REAL NOT NULL CHECK (morning_budget >= 0),
  lunch_budget REAL NOT NULL DEFAULT 0 CHECK (lunch_budget >= 0),
  morning_target_profit_rate REAL NOT NULL DEFAULT 0.05 CHECK (morning_target_profit_rate > 0),
  morning_stop_loss_rate REAL NOT NULL DEFAULT 0.03 CHECK (morning_stop_loss_rate > 0),
  lunch_entry_enabled INTEGER NOT NULL DEFAULT 0 CHECK (lunch_entry_enabled IN (0, 1)),
  lunch_target_profit_rate REAL NOT NULL DEFAULT 0.03 CHECK (lunch_target_profit_rate > 0),
  lunch_stop_loss_rate REAL NOT NULL DEFAULT 0.03 CHECK (lunch_stop_loss_rate > 0),
  holding_symbol TEXT,
  holding_symbol_name TEXT,
  holding_entry_window TEXT CHECK (holding_entry_window IN ('MORNING', 'LUNCH')),
  started_at TEXT,
  stopped_at TEXT,
  last_evaluated_at TEXT,
  last_decision TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  morning_liquidate_time TEXT,
  lunch_liquidate_time TEXT,
  auto_budget_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_budget_enabled IN (0, 1)),
  -- 고정 예산 모드일 때 morning_budget는 반드시 > 0이어야 한다.
  -- 자동 예산 모드(auto_budget_enabled = 1)일 때만 0을 허용한다.
  CHECK (auto_budget_enabled = 1 OR morning_budget > 0),
  CHECK (auto_budget_enabled = 1 OR lunch_entry_enabled = 0 OR lunch_budget > 0)
);

INSERT INTO kr_rank_strategies_new (
  id, user_id, status, morning_budget, lunch_budget,
  morning_target_profit_rate, morning_stop_loss_rate,
  lunch_entry_enabled, lunch_target_profit_rate, lunch_stop_loss_rate,
  holding_symbol, holding_symbol_name, holding_entry_window,
  started_at, stopped_at, last_evaluated_at, last_decision, last_error_message,
  created_at, updated_at, morning_liquidate_time, lunch_liquidate_time
)
SELECT
  id, user_id, status, morning_budget, lunch_budget,
  morning_target_profit_rate, morning_stop_loss_rate,
  lunch_entry_enabled, lunch_target_profit_rate, lunch_stop_loss_rate,
  holding_symbol, holding_symbol_name, holding_entry_window,
  started_at, stopped_at, last_evaluated_at, last_decision, last_error_message,
  created_at, updated_at, morning_liquidate_time, lunch_liquidate_time
FROM kr_rank_strategies;

DROP TABLE kr_rank_strategies;
ALTER TABLE kr_rank_strategies_new RENAME TO kr_rank_strategies;

CREATE INDEX IF NOT EXISTS idx_kr_rank_strategies_user_status
  ON kr_rank_strategies(user_id, status, id DESC);
