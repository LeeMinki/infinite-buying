PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  total_budget INTEGER NOT NULL CHECK (total_budget > 0),
  split_count INTEGER NOT NULL DEFAULT 40 CHECK (split_count > 0),
  buy_amount_per_round INTEGER NOT NULL CHECK (buy_amount_per_round >= 0),
  target_profit_rate REAL NOT NULL DEFAULT 0.10 CHECK (target_profit_rate > 0),
  current_round INTEGER NOT NULL DEFAULT 1 CHECK (current_round > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL UNIQUE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  average_price REAL NOT NULL DEFAULT 0 CHECK (average_price >= 0),
  invested_amount INTEGER NOT NULL DEFAULT 0 CHECK (invested_amount >= 0),
  remaining_budget INTEGER NOT NULL CHECK (remaining_budget >= 0),
  realized_profit INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS virtual_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL,
  order_date TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price REAL NOT NULL CHECK (price > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FILLED', 'CANCELED')),
  round_no INTEGER NOT NULL CHECK (round_no > 0),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  filled_at TEXT,
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_virtual_orders_buy_strategy_date_round
ON virtual_orders(strategy_id, order_date, round_no)
WHERE side = 'BUY';

CREATE TABLE IF NOT EXISTS decision_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL,
  input_price REAL NOT NULL CHECK (input_price > 0),
  average_price REAL NOT NULL DEFAULT 0 CHECK (average_price >= 0),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'PAUSE')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS market_price_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_code TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(stock_code, date)
);
