-- 랭킹 전략 삭제 시 주문·판단·진입/매매 이력을 보존하기 위한 soft delete 컬럼.
ALTER TABLE kr_rank_strategies ADD COLUMN deleted_at TEXT;
ALTER TABLE us_rank_strategies ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_kr_rank_strategies_user_deleted_status
  ON kr_rank_strategies(user_id, deleted_at, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_us_rank_strategies_user_deleted_status
  ON us_rank_strategies(user_id, deleted_at, status, id DESC);
