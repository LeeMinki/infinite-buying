-- 한국 국장 랭킹 전략은 진입 직전 10분 동안 상승률 랭킹을 반복 관찰한 뒤
-- 09:10/11:30 진입 시점에 종합 판단한다.
CREATE TABLE IF NOT EXISTS kr_rank_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id INTEGER NOT NULL REFERENCES kr_rank_strategies(id) ON DELETE CASCADE,
  trade_date TEXT NOT NULL,
  entry_window TEXT NOT NULL CHECK (entry_window IN ('MORNING', 'LUNCH')),
  ranking_snapshot TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kr_rank_observations_strategy_window
  ON kr_rank_observations(strategy_id, trade_date, entry_window, observed_at);
