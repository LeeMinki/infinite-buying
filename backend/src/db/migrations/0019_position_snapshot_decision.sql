-- 포지션 스냅샷이 어떤 판단(BUY/SELL/HOLD/SKIP/ERROR/COMPLETED 등)과 함께 찍혔는지 알 수 있도록 컬럼 추가.
-- "최근 포지션 스냅샷" UI에서 그 시점의 자동매매 판단을 같이 보여주기 위함.
ALTER TABLE auto_trading_position_snapshots ADD COLUMN decision TEXT;
