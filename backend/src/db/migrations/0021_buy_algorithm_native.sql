ALTER TABLE auto_trading_orders
  ADD COLUMN half TEXT;

ALTER TABLE auto_trading_orders
  ADD COLUMN decision_log_id INTEGER REFERENCES auto_trading_decision_logs(id) ON DELETE SET NULL;

ALTER TABLE auto_trading_strategies
  ADD COLUMN pending_avg_budget REAL NOT NULL DEFAULT 0 CHECK (pending_avg_budget >= 0);

ALTER TABLE auto_trading_strategies
  ADD COLUMN pending_big_budget REAL NOT NULL DEFAULT 0 CHECK (pending_big_budget >= 0);

CREATE INDEX IF NOT EXISTS idx_auto_trading_orders_decision_log
  ON auto_trading_orders(user_id, decision_log_id);

-- 백테스트 소수점매매 옵션. 기본은 0 (1주 단위 매수). 1이면 소수점 수량 시뮬레이션.
ALTER TABLE backtest_runs
  ADD COLUMN allow_fractional_shares INTEGER NOT NULL DEFAULT 0 CHECK (allow_fractional_shares IN (0, 1));
