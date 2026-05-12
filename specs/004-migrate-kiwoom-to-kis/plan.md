# Implementation Plan: Migrate Kiwoom to KIS

**Branch**: `013-migrate-kiwoom-to-kis`
**Date**: 2026-05-12
**Spec**: [spec.md](./spec.md)

## Summary

Replace the Kiwoom-centered implementation with a 한국투자증권(Korea Investment & Securities Co., Ltd., 이하 KIS) Open API based flow for user-scoped credential storage, domestic/overseas symbol lookup, current price lookup, daily candle lookup, market cache upsert, and KIS OHLC backtests. The backend is the only component that calls KIS APIs. The frontend provides KIS setup and backtest screens.

## Technical Context

**Language/Version**: JavaScript on Node.js 22+, React 19-compatible frontend
**Backend Dependencies**: Express, better-sqlite3, bcrypt, express-session, dotenv, cors
**Frontend Dependencies**: Vite, React, Recharts
**Storage**: SQLite
**Broker API**: KIS Open API
**Target Market**: Domestic and overseas stocks/ETFs supported by KIS quotation APIs
**Primary Examples**: TQQQ, 005930
**Currency**: KIS response currency, KRW for domestic symbols and USD for US symbols

## Architecture

- Browser calls Express APIs with httpOnly session cookie authentication.
- Express authenticates requests and scopes all queries by `req.userId`.
- KIS credentials are encrypted before persistence.
- `KisAuthService` issues or reuses KIS access tokens.
- `KisMarketDataProvider` fetches current price and daily candles from KIS.
- `market_price_cache` stores daily candles by `(userId, market, symbol, date)`.
- `BacktestService` fetches KIS daily candles, upserts cache rows, and runs the `LAOR_INFINITE_V2` backtest engine.

## Data Model

- `kis_credentials`
- `market_price_cache`
- `backtest_runs`
- `backtest_trades`

See [data-model.md](./data-model.md).

## API Plan

- `GET /api/settings/kis`
- `POST /api/settings/kis`
- `DELETE /api/settings/kis`
- `POST /api/settings/kis/test`
- `GET /api/market/stocks/search?q=TQQQ`
- `GET /api/market/:market/:symbol/price`
- `GET /api/market/:market/:symbol/daily?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /api/backtests`
- `GET /api/backtests`
- `GET /api/backtests/:id`
- `GET /api/backtests/:id/trades`
- `DELETE /api/backtests/:id`

## Frontend Plan

- Add KIS Setup page.
- Show KIS Developers preparation guidance.
- Use TQQQ as the default backtest symbol and support domestic examples such as 005930.
- Label backtest input as a KIS symbol or domestic stock code.
- Display budgets, prices, and results in the selected symbol's currency.
- Display risk notice that results do not guarantee investment returns.

## Security Plan

- Use bcrypt for password hashes.
- Use AES-256-GCM for App Secret/access token encryption.
- Do not log password, App Secret, or access token.
- Do not return App Secret or access token to frontend.
- Enforce `ENABLE_LIVE_ORDER=false`.
- Enforce `ENABLE_RESERVED_ORDER=false`.
- Do not implement order or reserved-order API routes.

## Test Plan

- KIS credential save/read/delete tests
- KIS auth token mock tests
- KIS domestic/overseas market data provider mock tests
- TQQQ and domestic-symbol backtest mock tests
- Cross-user access isolation tests
- Secret/token exposure checks
- Documentation and route audits

## Implementation Order

1. Environment and DB schema.
2. KIS credential repository/service/routes.
3. KIS auth service and connection test.
4. KIS market data provider and market routes.
5. Backtest service updates for symbol/market/currency.
6. React KIS setup and backtest UI.
7. Tests and README.
