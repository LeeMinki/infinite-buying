# Data Model: KIS Auto Trading

## Naming Conventions

- SQLite table names use snake_case.
- Application objects use camelCase.
- Every user-owned row includes `user_id`.
- Timestamps are ISO-compatible text values.
- Monetary and quantity values are stored as numeric values in the market currency.

## user_trading_settings

User-wide live-order switch.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | integer | yes | Primary key |
| user_id | integer | yes | Unique per user |
| live_order_enabled | integer boolean | yes | Defaults to 0 |
| live_order_enabled_updated_at | text | yes | Updated on toggle |
| created_at | text | yes | Default current time |
| updated_at | text | yes | Default current time |

Indexes and constraints:

- `UNIQUE(user_id)`
- Index on `user_id`

Validation:

- New users default to `live_order_enabled=0`.
- Toggle writes must also create a history row.

## user_trading_setting_histories

Audit trail for live-order setting changes.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | integer | yes | Primary key |
| user_id | integer | yes | Owner |
| previous_live_order_enabled | integer boolean | yes | Previous value |
| new_live_order_enabled | integer boolean | yes | New value |
| changed_at | text | yes | Change time |

Indexes:

- `(user_id, changed_at DESC)`

Validation:

- History row is created only when value changes.
- History values must be booleans.

## auto_trading_strategies

Automatic trading plan for one selected symbol.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | integer | yes | Primary key |
| user_id | integer | yes | Owner |
| symbol | text | yes | Selected symbol/code |
| symbol_name | text | no | Display name from search |
| market | text | yes | `KR`, `US`, or future KIS-supported market |
| currency | text | yes | `KRW`, `USD`, or response currency |
| status | text | yes | `CREATED`, `RUNNING`, `STOPPED`, `ERROR` |
| total_budget | real | yes | Strategy budget in currency |
| split_count | integer | yes | Default 40 |
| buy_amount_per_round | real | yes | `floor(total_budget / split_count)` for strategy display/order sizing |
| target_profit_rate | real | yes | Default 0.1 |
| big_buy_premium_rate | real | yes | Default 0.1. Big-number buy half is eligible at or below `previous_close_or_base_price × (1 + big_buy_premium_rate)`. |
| current_round | integer | yes | Starts at 0 |
| max_order_amount | real | yes | Legacy per-order cap. Retained for migration safety; written as 0 by new code and ignored by SafetyGuard. |
| max_daily_order_amount | real | yes | Legacy daily cap. Retained for migration safety; written as 0 by new code and ignored by SafetyGuard. |
| started_at | text | no | Set on start |
| stopped_at | text | no | Set on stop |
| last_evaluated_at | text | no | Last evaluation time |
| last_order_at | text | no | Last order record time |
| last_decision | text | no | BUY/SELL/HOLD/SKIP/ERROR |
| last_error_message | text | no | Safe message only |
| created_at | text | yes | Default current time |
| updated_at | text | yes | Default current time |

Indexes:

- `(user_id, status, id DESC)` (composite, used for dashboard listing in `idx_auto_trading_strategies_user_status`)

Validation:

- `status` must be one of allowed states.
- `split_count > 0`
- `total_budget > 0`
- `buy_amount_per_round >= 0` (set to `total_budget / split_count` on create; allowed to round to zero before evaluation populates fields)
- `target_profit_rate > 0`
- `big_buy_premium_rate >= 0`
- `max_order_amount >= 0` (legacy; new strategies always set 0 and SafetyGuard does not read this field)
- `max_daily_order_amount >= 0` (legacy; new strategies always set 0 and SafetyGuard does not read this field)
- `current_round >= 0`

State transitions:

```text
CREATED -> RUNNING
CREATED -> STOPPED
RUNNING -> STOPPED
RUNNING -> ERROR
ERROR -> RUNNING
ERROR -> STOPPED
STOPPED -> RUNNING
```

Notes:

- STOPPED strategies are excluded from scheduled evaluation.
- Stopping does not cancel already submitted orders.
- Deleting a strategy removes the row and cascades to `auto_trading_position_snapshots`, `auto_trading_orders`, `auto_trading_decision_logs`, `auto_trading_locks`, and `daily_order_limit_usages` for the same `strategy_id`, but does not cancel already submitted broker orders at KIS.

## auto_trading_position_snapshots

Point-in-time account and price view used by evaluation.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | integer | yes | Primary key |
| user_id | integer | yes | Owner |
| strategy_id | integer | yes | Related strategy |
| symbol | text | yes | Snapshot symbol |
| market | text | yes | Snapshot market |
| currency | text | yes | Snapshot currency |
| quantity | real | yes | KIS holding quantity |
| average_price | real | yes | KIS average price |
| current_price | real | yes | KIS current price |
| evaluation_amount | real | yes | quantity × current price |
| unrealized_profit | real | yes | Evaluation minus cost basis |
| unrealized_profit_rate | real | yes | Profit rate |
| cash_available | real | no | Buying power/cash if available |
| source | text | yes | `KIS` |
| decision | text | no | BUY/SELL/HOLD/SKIP/ERROR/COMPLETED produced by the evaluation that wrote this snapshot. Lets the UI show the action that accompanied the snapshot. Nullable for backward compatibility with rows written before this column existed. |
| captured_at | text | yes | Capture time |

Indexes:

- `(user_id, strategy_id, captured_at DESC)` (`idx_auto_trading_position_snapshots_user_strategy`)

Validation:

- Quantities and prices must be non-negative.
- Source is `KIS` for this feature.

## auto_trading_orders

Dry-run or real-order lifecycle record.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | integer | yes | Primary key |
| user_id | integer | yes | Owner |
| strategy_id | integer | yes | Related strategy |
| symbol | text | yes | Order symbol |
| market | text | yes | Market |
| currency | text | yes | Currency |
| side | text | yes | `BUY` or `SELL` |
| quantity | real | yes | Order quantity |
| order_price | real | yes | Expected/request price |
| estimated_amount | real | yes | quantity × order price |
| kis_order_no | text | no | Broker order number |
| kis_original_order_no | text | no | Original order number/branch number when available |
| status | text | yes | Order state |
| filled_quantity | real | no | Filled quantity |
| remaining_quantity | real | no | Open quantity |
| average_filled_price | real | no | Average fill price |
| idempotency_key | text | yes | Unique duplicate-prevention key |
| decision_reason | text | yes | User-readable reason |
| live_order_enabled | integer boolean | yes | Setting at decision time |
| request_payload_masked | text | no | Safe JSON metadata only |
| response_payload_masked | text | no | Safe JSON metadata only |
| error_message | text | no | Safe message only |
| created_at | text | yes | Default current time |
| updated_at | text | yes | Default current time |

Indexes and constraints:

- `UNIQUE(idempotency_key)`
- `(user_id, strategy_id, created_at DESC)` (`idx_auto_trading_orders_user_strategy`)
- `(user_id, status, created_at DESC)` (`idx_auto_trading_orders_user_status`)

Allowed status:

- `DECIDED`
- `DRY_RUN`
- `REQUESTED`
- `ACCEPTED`
- `REJECTED`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`
- `FAILED`
- `UNKNOWN`

Validation:

- `side` must be BUY or SELL.
- `quantity > 0`
- `order_price > 0`
- `estimated_amount >= 0` (DRY_RUN snapshots may evaluate to 0 when expected price/quantity rounds away)
- Raw secret/token/account values must not be stored in payload fields.

State transitions:

```text
DECIDED -> DRY_RUN
DECIDED -> REQUESTED
REQUESTED -> ACCEPTED
REQUESTED -> REJECTED
REQUESTED -> FAILED
ACCEPTED -> PARTIALLY_FILLED
ACCEPTED -> FILLED
ACCEPTED -> CANCELED
ACCEPTED -> UNKNOWN
PARTIALLY_FILLED -> FILLED
PARTIALLY_FILLED -> CANCELED
PARTIALLY_FILLED -> UNKNOWN
UNKNOWN -> ACCEPTED
UNKNOWN -> PARTIALLY_FILLED
UNKNOWN -> FILLED
UNKNOWN -> CANCELED
```

## auto_trading_decision_logs

User-visible evaluation log.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | integer | yes | Primary key |
| user_id | integer | yes | Owner |
| strategy_id | integer | yes | Related strategy |
| symbol | text | yes | Symbol |
| market | text | yes | Market |
| currency | text | yes | Currency |
| current_price | real | yes | Evaluation price |
| average_price | real | yes | KIS average price |
| holding_quantity | real | yes | KIS quantity |
| cash_available | real | no | Buying power/cash |
| current_round | integer | yes | Strategy round at decision |
| decision | text | yes | BUY/SELL/HOLD/SKIP/ERROR |
| expected_quantity | real | no | Expected order quantity |
| expected_order_price | real | no | Expected price |
| expected_amount | real | no | Expected amount |
| live_order_enabled | integer boolean | yes | Setting at decision time |
| reason | text | yes | User-readable safe reason |
| target_sell_price | real | no | Computed as `average_price × (1 + target_profit_rate)`. Null until the strategy has a position. |
| distance_to_target_rate | real | no | Signed ratio `(target_sell_price − current_price) / target_sell_price`. Negative or zero means the price has reached the target; positive means the remaining upside required to trigger a sell. |
| open_order_count | integer | yes | Number of open KIS orders at evaluation time; defaults to 0. Used to filter "blocked because open order exists" cases without re-parsing the reason text. |
| evaluation_source | text | yes | `SCHEDULED` (background scheduler run) or `MANUAL` (user-triggered "지금 평가"). Defaults to `SCHEDULED`. |
| order_id | integer | no | Back-link to the `auto_trading_orders` row that this evaluation created. Null when no order was generated. |
| created_at | text | yes | Default current time |

Indexes:

- `(user_id, strategy_id, created_at DESC)` (`idx_auto_trading_decision_logs_user_strategy`)

Validation:

- Decision must be BUY, SELL, HOLD, SKIP, or ERROR.
- Reasons must not include secret/token/account raw values.

## auto_trading_locks

Short-lived per-strategy lock.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | integer | yes | Primary key |
| user_id | integer | yes | Owner |
| strategy_id | integer | yes | Strategy |
| lock_key | text | yes | Unique lock key |
| locked_until | text | yes | Expiry time |
| created_at | text | yes | Default current time |

Indexes and constraints:

- `UNIQUE(strategy_id, lock_key)` — one active lock per (strategy, key) pair
- `(locked_until)` (`idx_auto_trading_locks_until`)

Validation:

- Expired locks can be replaced or removed.
- Lock key should include strategy id.

## daily_order_limit_usages

Tracks daily order amount usage.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | integer | yes | Primary key |
| user_id | integer | yes | Owner |
| strategy_id | integer | yes | Strategy |
| trade_date | text | yes | Local trade date |
| market | text | yes | Market |
| currency | text | yes | Currency |
| used_amount | real | yes | Used amount for daily cap |
| created_at | text | yes | Default current time |
| updated_at | text | yes | Default current time |

Indexes and constraints:

- `UNIQUE(user_id, strategy_id, trade_date)` — daily usage is aggregated per (user, strategy, date); `market`/`currency` are stored on the row but not part of the unique key because each strategy is a single market/currency.
- `(user_id, strategy_id, trade_date)` (`idx_daily_order_limit_usages_user_strategy_date`)

Validation:

- `used_amount >= 0`
- Usage increments only for accepted/filled real-order states chosen during implementation.

## Existing Entity Interactions

### kis_credentials

- Existing encrypted credential store.
- 005 reuses App Key/App Secret/account fields and encrypted access token.
- `KisTokenManager` updates token fields and status.

### Stock Search Result

Existing search results provide:

- `symbol`
- `name`
- `market`
- `exchange`
- `currency`
- optional fractional/unit metadata

Auto trading strategy creation copies symbol, name, market, and currency. Fractional metadata is not used for 005 live order sizing because whole-share orders are the scope.
