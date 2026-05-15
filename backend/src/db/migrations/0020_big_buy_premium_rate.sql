ALTER TABLE strategies
  ADD COLUMN big_buy_premium_rate REAL CHECK (big_buy_premium_rate IS NULL OR big_buy_premium_rate >= 0);

ALTER TABLE backtest_runs
  ADD COLUMN big_buy_premium_rate REAL CHECK (big_buy_premium_rate IS NULL OR big_buy_premium_rate >= 0);

ALTER TABLE auto_trading_strategies
  ADD COLUMN big_buy_premium_rate REAL CHECK (big_buy_premium_rate IS NULL OR big_buy_premium_rate >= 0);
