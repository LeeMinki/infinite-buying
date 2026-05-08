# Feature Specification: Real-Price Backtest

**Feature Branch**: `003-real-price-backtest`
**Created**: 2026-04-29
**Updated**: 2026-05-08
**Status**: Implemented

> Note: The directory name is historical. The implemented 003 scope is backtest-only with actual Kiwoom daily prices. Simulator and LIVE-mode scaffolding were removed from the current MVP.

## User Story - Run a Backtest from Actual Historical Prices

An authenticated user can select a stock, date range, budget, split count, target profit rate, and restart-after-sell option. The app fetches actual historical daily prices through the backend, runs the infinite-buying calculation over daily close prices in chronological order, and shows summary, trades, and charts.

**Independent Test**: Sign in, save valid Kiwoom credentials, run a backtest for a stock/date range, and verify the result is calculated from actual daily close prices for the current user only.

### Acceptance Scenarios

1. **Given** a logged-in user with valid Kiwoom settings, **When** they run a backtest, **Then** the app fetches actual historical daily prices and completes the calculation.
2. **Given** actual prices are unavailable, **When** the user runs a backtest, **Then** the app shows a clear message asking them to check Kiwoom settings and server IP registration.
3. **Given** another user owns a backtest, **When** the current user requests that run or trade list directly, **Then** the app behaves as if the data does not exist.
4. **Given** restart-after-sell is disabled, **When** a full sell occurs, **Then** the run does not start a new buying cycle.
5. **Given** restart-after-sell is enabled, **When** a full sell occurs, **Then** the run may start a new buying cycle inside the selected period.

## Requirements

- **FR-001**: The system MUST require authentication for all backtest screens and APIs.
- **FR-002**: The system MUST scope every backtest run, backtest trade, and stored price row to the current user.
- **FR-003**: The system MUST fetch actual historical daily prices through the backend before creating a backtest run. The backend may reuse stored user-scoped Kiwoom rows when they already cover the requested range; otherwise it MUST call Kiwoom and persist the returned rows before the run is created.
- **FR-004**: The system MUST use each trading day's close price as the evaluation price.
- **FR-005**: The system MUST process prices in chronological order.
- **FR-006**: The system MUST calculate BUY, SELL, HOLD, and COMPLETED decisions with the shared strategy engine.
- **FR-007**: The system MUST show final asset, return rate, realized/unrealized profit, max drawdown, buy/sell counts, and final holding state.
- **FR-008**: The system MUST show trade history, asset curve, and average-price-vs-close chart.
- **FR-009**: The system MUST NOT expose old single-price evaluation screens, old single-price APIs, or mode-selection UI.
- **FR-010**: The system MUST use only Kiwoom-sourced daily market data for backtests. Backtest calculation itself MUST read stored user-scoped Kiwoom rows and MUST NOT call Kiwoom during the date-by-date simulation loop.
- **FR-011**: The system MUST NOT call Kiwoom order APIs or execute real orders.
- **FR-012**: The system MUST show that results are calculated from actual historical prices and do not guarantee profit.

## Out of Scope

- Single-price evaluation workflow.
- Real order execution.
- Order/fill synchronization.
- Fees, taxes, and slippage.
- Social login, email verification, and password recovery.

## Success Criteria

- A user can run a backtest from the `백테스트` button without choosing a mode.
- Backtest UI contains no mode-selection wording.
- Backend exposes only the backtest workflow for historical validation.
- Automated tests and frontend build pass.
