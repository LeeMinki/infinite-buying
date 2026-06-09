-- KIS 기간별매매손익현황조회(TTTC8715R) 기준 실현손익/손익률.
-- 기존 profit_rate는 체결가 기준 평가 손익률(gross)로 유지하고,
-- 이 컬럼들은 수수료·제세금 반영 후 KIS가 계산한 실현 손익률(net)을 저장한다.
ALTER TABLE kr_rank_orders ADD COLUMN realized_profit_amount REAL;
ALTER TABLE kr_rank_orders ADD COLUMN realized_profit_rate REAL;
ALTER TABLE kr_rank_orders ADD COLUMN realized_fee_amount REAL;
ALTER TABLE kr_rank_orders ADD COLUMN realized_tax_amount REAL;
ALTER TABLE kr_rank_orders ADD COLUMN realized_profit_synced_at TEXT;
ALTER TABLE kr_rank_orders ADD COLUMN realized_profit_source TEXT;

CREATE INDEX IF NOT EXISTS idx_kr_rank_orders_realized_profit_sync
  ON kr_rank_orders(user_id, strategy_id, side, status, realized_profit_synced_at);
