# Data Model: Migrate Kiwoom to KIS

## `kis_credentials`

Stores one KIS configuration per user.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `user_id` | INTEGER | Unique, FK to `users(id)` |
| `app_key_masked` | TEXT | Safe display value |
| `app_key_encrypted` | TEXT | AES-256-GCM |
| `app_secret_encrypted` | TEXT | AES-256-GCM |
| `access_token_encrypted` | TEXT nullable | AES-256-GCM |
| `token_expires_at` | TEXT nullable | ISO datetime |
| `account_number_encrypted` | TEXT nullable | AES-256-GCM |
| `account_product_code_encrypted` | TEXT nullable | AES-256-GCM |
| `status` | TEXT | `NOT_CONFIGURED`, `CONFIGURED`, `TOKEN_VALID`, `TOKEN_ERROR` |
| `last_token_issued_at` | TEXT nullable | ISO datetime |
| `last_token_error_message` | TEXT nullable | Safe message only |
| `created_at` | TEXT | Created timestamp |
| `updated_at` | TEXT | Updated timestamp |

## `market_price_cache`

Stores user-scoped KIS daily candles.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `user_id` | INTEGER | FK to `users(id)` |
| `symbol` | TEXT | Uppercase overseas symbol or domestic stock code |
| `market` | TEXT | `KR` or `US` |
| `exchange` | TEXT nullable | KIS exchange code such as `KRX` or `NAS` |
| `date` | TEXT | `YYYY-MM-DD` |
| `open` | REAL | Market currency |
| `high` | REAL | Market currency |
| `low` | REAL | Market currency |
| `close` | REAL | Market currency |
| `volume` | INTEGER | Shares |
| `currency` | TEXT | `KRW` or `USD` |
| `source` | TEXT | `KIS_API` |
| `created_at` | TEXT | Created timestamp |
| `updated_at` | TEXT | Updated timestamp |

Unique key: `(user_id, market, symbol, date)`.

## `backtest_runs`

Stores one backtest request and summary.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `user_id` | INTEGER | FK to `users(id)` |
| `symbol` | TEXT | Uppercase overseas symbol or domestic stock code |
| `market` | TEXT | `KR` or `US` |
| `data_source` | TEXT | `KIS_API` |
| `currency` | TEXT | `KRW` or `USD` |
| `from_date` | TEXT | `YYYY-MM-DD` |
| `to_date` | TEXT | `YYYY-MM-DD` |
| `total_budget` | REAL | Market currency |
| `split_count` | INTEGER | Positive integer |
| `buy_amount_per_round` | REAL | `total_budget / split_count` |
| `algorithm` | TEXT | `LAOR_INFINITE_V2` |
| `initial_lump_ratio` | REAL | Reserved compatibility field, not used by current engine |
| `daily_amount` | REAL | Reserved compatibility field, not used by current engine |
| `target_profit_rate` | REAL | Example: `0.1` for 10% |
| `restart_after_sell` | INTEGER | `0` or `1` |
| `status` | TEXT | `RUNNING`, `COMPLETED`, `FAILED` |
| `initial_budget` | REAL | Market currency |
| `final_asset` | REAL | Market currency |
| `realized_profit` | REAL | Market currency |
| `unrealized_profit` | REAL | Market currency |
| `return_rate` | REAL | Decimal |
| `max_invested_amount` | REAL | Market currency |
| `max_drawdown_rate` | REAL | Decimal |
| `total_buy_count` | INTEGER | Count |
| `total_sell_count` | INTEGER | Count |
| `final_holding_quantity` | REAL | Shares; overseas runs may be fractional |
| `final_average_price` | REAL | Market currency |
| `error_message` | TEXT nullable | Safe message |
| `created_at` | TEXT | Created timestamp |
| `completed_at` | TEXT nullable | Completion timestamp |

## `backtest_trades`

Stores per-date virtual decisions for one run.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `user_id` | INTEGER | FK to `users(id)` |
| `run_id` | INTEGER | FK to `backtest_runs(id)` |
| `trade_date` | TEXT | `YYYY-MM-DD` |
| `side` | TEXT | `BUY`, `SELL`, `HOLD`, `COMPLETED` |
| `price` | REAL | Daily close, market currency |
| `quantity` | REAL | Shares; overseas runs may be fractional |
| `amount` | REAL | Market currency |
| `round_no` | INTEGER | Strategy round |
| `cash` | REAL | Market currency |
| `holding_quantity` | REAL | Shares; overseas runs may be fractional |
| `average_price` | REAL | Market currency |
| `invested_amount` | REAL | Market currency |
| `realized_profit` | REAL | Market currency |
| `unrealized_profit` | REAL | Market currency |
| `evaluation_amount` | REAL | Market currency |
| `total_asset` | REAL | Market currency |
| `drawdown_rate` | REAL | Decimal |
| `reason` | TEXT | Safe explanation |
| `created_at` | TEXT | Created timestamp |
