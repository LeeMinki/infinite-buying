# Research: Real-Price Backtest

## Decision: Keep only backtest

Single-price evaluation does not match the user's expectation for continuous historical validation. The product now exposes backtest as the only expanded workflow.

## Decision: Use Kiwoom market data only

Backtest results must be based on actual historical prices. Development fixture data is not a supported market-data source for user-facing backtests.

## Decision: Fetch prices before run creation

The UI presents one backtest action. Internally, the app fetches actual daily prices first and then creates the backtest run from stored user-scoped rows. This keeps user flow simple while preserving reproducible backend calculation.
