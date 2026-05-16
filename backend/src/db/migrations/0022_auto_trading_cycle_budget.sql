-- 자동매매 사이클 예산. 매도(목표 매도 / 회차 소진 1/4 매도)로 사이클이 재시작될 때
-- 그 시점의 총자산(현금 + 보유평가액)을 다음 사이클 예산으로 삼는 복리 방식.
-- 0이면 사이클 예산 미설정 상태로, 평가 엔진이 total_budget 을 사용한다.
ALTER TABLE auto_trading_strategies
  ADD COLUMN cycle_budget REAL NOT NULL DEFAULT 0 CHECK (cycle_budget >= 0);

-- 기존 전략은 현재 총예산을 첫 사이클 예산으로 채워 둔다.
UPDATE auto_trading_strategies
  SET cycle_budget = total_budget
  WHERE cycle_budget = 0;
