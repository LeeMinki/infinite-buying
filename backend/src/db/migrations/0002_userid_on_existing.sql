ALTER TABLE strategies ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE holdings ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE virtual_orders ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE decision_logs ADD COLUMN user_id INTEGER REFERENCES users(id);

UPDATE holdings
SET user_id = (SELECT strategies.user_id FROM strategies WHERE strategies.id = holdings.strategy_id)
WHERE user_id IS NULL;

UPDATE virtual_orders
SET user_id = (SELECT strategies.user_id FROM strategies WHERE strategies.id = virtual_orders.strategy_id)
WHERE user_id IS NULL;

UPDATE decision_logs
SET user_id = (SELECT strategies.user_id FROM strategies WHERE strategies.id = decision_logs.strategy_id)
WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id, id);
CREATE INDEX IF NOT EXISTS idx_holdings_user_strategy ON holdings(user_id, strategy_id);
CREATE INDEX IF NOT EXISTS idx_virtual_orders_user_strategy ON virtual_orders(user_id, strategy_id);
CREATE INDEX IF NOT EXISTS idx_decision_logs_user_strategy ON decision_logs(user_id, strategy_id);
