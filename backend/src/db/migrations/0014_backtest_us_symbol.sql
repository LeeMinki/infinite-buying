ALTER TABLE backtest_runs ADD COLUMN symbol TEXT;
ALTER TABLE backtest_runs ADD COLUMN market TEXT NOT NULL DEFAULT 'US';
ALTER TABLE backtest_runs ADD COLUMN data_source TEXT NOT NULL DEFAULT 'KIS_API';
ALTER TABLE backtest_runs ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';

UPDATE backtest_runs
SET symbol = stock_code
WHERE symbol IS NULL AND stock_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_runs_user_symbol
  ON backtest_runs(user_id, market, symbol);
