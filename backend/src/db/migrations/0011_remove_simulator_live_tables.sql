DELETE FROM market_price_cache
WHERE UPPER(COALESCE(source, '')) <> 'KIWOOM';

DROP TABLE IF EXISTS simulation_trades;
DROP TABLE IF EXISTS simulation_runs;
DROP TABLE IF EXISTS live_trading_configs;
