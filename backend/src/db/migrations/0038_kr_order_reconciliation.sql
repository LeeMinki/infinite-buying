-- 운영자가 증권사 전체 조회 결과를 확인하고 종결한 미확정 주문의 감사 기록.
CREATE TABLE kr_order_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  strategy_id INTEGER NOT NULL REFERENCES kr_rank_strategies(id),
  order_id INTEGER NOT NULL UNIQUE REFERENCES kr_rank_orders(id),
  entry_id INTEGER NOT NULL REFERENCES kr_rank_entries(id),
  actor TEXT NOT NULL CHECK (actor = 'OPERATOR'),
  reason_code TEXT NOT NULL CHECK (reason_code = 'VERIFIED_ABSENT_AFTER_RATE_LIMIT'),
  original_status TEXT NOT NULL,
  original_error_code TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
