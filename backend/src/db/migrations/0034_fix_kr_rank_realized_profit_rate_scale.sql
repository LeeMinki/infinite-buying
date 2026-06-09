-- KIS TTTC8715R pfls_rt is a percentage string even below 1%.
-- Rows synced by the previous normalizer stored values like -0.42629179 as -42.629179%.
-- Recalculate already-synced KR rank sell rows from the broker realized P&L amount and paired buy cost.
UPDATE kr_rank_orders AS sell
SET realized_profit_rate = (
      sell.realized_profit_amount / (
        SELECT sell.quantity * COALESCE(NULLIF(buy.average_filled_price, 0), buy.order_price)
        FROM kr_rank_orders AS buy
        WHERE buy.user_id = sell.user_id
          AND buy.strategy_id = sell.strategy_id
          AND buy.side = 'BUY'
          AND buy.symbol = sell.symbol
          AND buy.entry_window = sell.entry_window
          AND buy.created_at <= sell.created_at
          AND buy.status NOT IN ('FAILED', 'REJECTED', 'CANCELED')
        ORDER BY buy.created_at DESC, buy.id DESC
        LIMIT 1
      )
    ),
    updated_at = datetime('now')
WHERE sell.side = 'SELL'
  AND sell.status = 'FILLED'
  AND sell.realized_profit_source = 'KIS_TTTC8715R'
  AND sell.realized_profit_amount IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM kr_rank_orders AS buy
    WHERE buy.user_id = sell.user_id
      AND buy.strategy_id = sell.strategy_id
      AND buy.side = 'BUY'
      AND buy.symbol = sell.symbol
      AND buy.entry_window = sell.entry_window
      AND buy.created_at <= sell.created_at
      AND buy.status NOT IN ('FAILED', 'REJECTED', 'CANCELED')
      AND buy.quantity > 0
      AND COALESCE(NULLIF(buy.average_filled_price, 0), buy.order_price) > 0
  );
