# Implementation Plan: Real-Price Backtest

## Summary

Replace the previous multi-mode direction with a single backtest workflow. The frontend links directly to Backtest, ensures actual historical Kiwoom prices are stored when the user runs a backtest, and then creates a user-scoped backtest run. Old mode-selection UI/API paths are removed. Market data uses Kiwoom only.

## Architecture

- Frontend `BacktestPage` collects stock, date range, budget, split count, target profit rate, and restart-after-sell.
- Frontend calls `GET /api/market/:stockCode/daily?from&to&requireReal=true` before creating a run.
- Backend reads the current user's `market_price_cache` rows for the requested range first. If those rows already cover the range within the weekend/holiday tolerance and are Kiwoom-sourced, they are returned.
- Otherwise the backend uses the current user's encrypted Kiwoom credentials to fetch daily prices, upserts them into the cache, and returns the stored rows.
- The API also supports `refresh=true` for operator/debug flows that need to force a Kiwoom round-trip.
- Frontend calls `POST /api/backtests`.
- `BacktestService` reads current-user stored price rows and runs `BacktestExecutionProvider`.
- `StrategyEngine` remains a pure function and has no DB, HTTP, or Kiwoom dependency.

## Backend Changes

- Keep only the backtest validation API.
- Remove the old single-price evaluation service, repository, execution provider, and tests.
- Remove non-Kiwoom market data providers and credential paths.
- Require `MARKET_DATA_PROVIDER=kiwoom`.
- Force Kiwoom credential saves to production environment.
- Reject non-Kiwoom stored price rows during backtest execution.
- `marketDataService.getDailyPrices` returns user-scoped Kiwoom rows from storage when they already cover the requested range, and falls through to Kiwoom only when the stored data is missing or insufficient. `refresh=true` forces a round-trip.

## Frontend Changes

- Remove old mode-selection and single-price evaluation screens.
- Rename sidebar action to `백테스트`.
- Backtest page has one primary run action. It fetches actual historical prices and runs the calculation.
- Remove user-facing wording about internal storage/provider details.
- Keep Kiwoom setup as the place where users register API credentials and server IP.

## Testing

- StrategyEngine unit tests.
- Backtest service tests.
- Cross-user backtest isolation tests.
- Route inventory checks for no old mode-selection API.
- Frontend production build.

## Deferred

- Real order execution.
- Scheduler.
- Fees, taxes, and slippage.
- More detailed backtest reports.
