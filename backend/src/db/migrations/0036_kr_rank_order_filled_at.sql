-- 주문 접수 시각(created_at)과 체결 확인 시각을 분리한다.
-- 기존 FILLED 주문은 당시 마지막 상태 갱신 시각을 가장 가까운 체결 확인 시각으로 사용한다.
ALTER TABLE kr_rank_orders ADD COLUMN filled_at TEXT;

UPDATE kr_rank_orders
SET filled_at = COALESCE(updated_at, created_at)
WHERE status = 'FILLED' AND filled_at IS NULL;
