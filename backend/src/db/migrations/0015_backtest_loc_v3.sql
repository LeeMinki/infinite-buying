-- 라오어 단기 무한매수법 백테스트 메타 컬럼 추가.
-- initial_lump_ratio / daily_amount는 호환을 위해 유지하지만 현재 엔진은 split_count 기반 LAOR_INFINITE_V2를 사용한다.
ALTER TABLE backtest_runs ADD COLUMN initial_lump_ratio REAL NOT NULL DEFAULT 0.5;
ALTER TABLE backtest_runs ADD COLUMN daily_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE backtest_runs ADD COLUMN algorithm TEXT NOT NULL DEFAULT 'LAOR_INFINITE_V2';
