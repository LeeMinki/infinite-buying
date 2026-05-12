# Feature Specification: Migrate Kiwoom to KIS

**Feature Branch**: `013-migrate-kiwoom-to-kis`
**Created**: 2026-05-12
**Status**: Ready for implementation
**Input**: Replace the Kiwoom-centered broker integration with 한국투자증권(Korea Investment & Securities Co., Ltd., 이하 KIS) Open API based flow for domestic/overseas price lookup and KIS OHLC backtesting.

## User Stories & Testing

### User Story 1 - Configure KIS Credentials (Priority: P1)

As a signed-in user, I can save my KIS Developers App Key and App Secret so the backend can request KIS access tokens for my account.

**Independent Test**: Sign in, open KIS settings, save App Key/App Secret, reload, verify only masked App Key is shown, and run a connection test without exposing secret or token values.

**Acceptance Scenarios**:

1. **Given** a logged-in user, **When** they save valid KIS credentials, **Then** the app stores encrypted values and returns only safe settings.
2. **Given** saved credentials, **When** the user runs connection test, **Then** the backend requests a KIS access token and returns success/failure without returning the token.
3. **Given** two users, **When** one user saves KIS credentials, **Then** the other user cannot view, test, update, or delete them.

### User Story 2 - Look Up KIS Market Prices (Priority: P2)

As a signed-in user, I can search symbols and fetch current price and daily candles through KIS Open API.

**Independent Test**: With saved KIS credentials, request `TQQQ` and `005930` current price/daily candles and verify the response uses `symbol`, `market`, `currency`, and `source='KIS_API'`.

**Acceptance Scenarios**:

1. **Given** KIS settings are configured, **When** the user requests `GET /api/market/US/TQQQ/price`, **Then** the backend returns a normalized USD current price.
2. **Given** KIS settings are configured, **When** the user requests `GET /api/market/KR/005930/daily`, **Then** the backend stores and returns normalized KRW daily candle rows.
3. **Given** no KIS settings, **When** market data is requested, **Then** the API returns `KIS API 설정을 먼저 완료하세요`.

### User Story 3 - Run KIS OHLC Backtests (Priority: P3)

As a signed-in user, I can run an infinite-buying style backtest using KIS daily open/high/close prices and the matching currency.

**Independent Test**: Run a backtest with `symbol=TQQQ` or `symbol=005930`, date range, budget, split count, target profit rate, and restart option; verify summary and trades are stored under the current user only.

**Acceptance Scenarios**:

1. **Given** KIS settings are configured, **When** the user creates a backtest, **Then** the backend fetches KIS daily candles, caches them, and calculates trades using open/high/close prices.
2. **Given** a completed run, **When** the user opens results, **Then** they see summary, trades, asset curve, average price, matching currency, and risk notice.
3. **Given** another user’s run id, **When** a user requests it directly, **Then** the API returns 404.

## Requirements

- **FR-001**: The system MUST provide KIS settings APIs: `GET /api/settings/kis`, `POST /api/settings/kis`, `DELETE /api/settings/kis`, `POST /api/settings/kis/test`.
- **FR-002**: The system MUST store App Key, App Secret, access token, and optional account fields encrypted when persisted.
- **FR-003**: The system MUST return App Key only in masked form.
- **FR-004**: The system MUST NOT return App Secret or access token to the frontend.
- **FR-005**: The system MUST use the configured KIS Open API base URL as a single broker API endpoint.
- **FR-006**: The system MUST provide market APIs: `GET /api/market/stocks/search`, `GET /api/market/:market/:symbol/price`, and `GET /api/market/:market/:symbol/daily`.
- **FR-007**: Market data responses MUST include `symbol`, `market`, `currency`, and `source`.
- **FR-008**: Daily candles MUST be upserted by `(userId, market, symbol, date)`.
- **FR-009**: Backtests MUST accept `symbol`, `fromDate`, `toDate`, `totalBudget`, `splitCount`, `targetProfitRate`, and `restartAfterSell`.
- **FR-010**: Backtests MUST fetch KIS daily candles during execution and use daily `open`, `high`, and `close` values.
- **FR-010a**: Backtests MUST use the `LAOR_INFINITE_V2` rules: per-round budget from `totalBudget / splitCount`, first buy at daily open when there is no holding, big/small LOC buy checks using daily close, target sell using daily high, and partial sell/reset after max rounds when needed.
- **FR-010b**: US/overseas backtests MUST allow fractional share quantities. Domestic backtests MAY use whole-share quantities.
- **FR-011**: Backtest values MUST be calculated and displayed in the market currency, KRW for domestic symbols and USD for US symbols.
- **FR-012**: The system MUST exclude fees, taxes, exchange rates, and slippage.
- **FR-013**: The system MUST NOT implement real-order or reserved-order APIs.
- **FR-014**: `ENABLE_LIVE_ORDER=false` and `ENABLE_RESERVED_ORDER=false` MUST remain enforced.
- **FR-015**: Every credential, market cache row, backtest run, and backtest trade MUST be scoped by current `userId`.
- **FR-016**: KIS failure messages MUST be safe and must not include raw secret or token values.

## Key Entities

- **KisCredential**: User-owned encrypted KIS App Key/App Secret, token status, token expiry, and safe status metadata.
- **MarketPriceCache**: User-owned daily candle cache with market, currency, and KIS source.
- **BacktestRun**: User-owned backtest request and summary for one symbol and date range.
- **BacktestTrade**: Per-day virtual trade/decision output for a backtest run.

## Success Criteria

- **SC-001**: A user can save KIS credentials and run a connection test.
- **SC-002**: A user can fetch `TQQQ` current price.
- **SC-003**: A user can fetch and cache `TQQQ` daily candles.
- **SC-004**: A user can run a KIS OHLC backtest and view results in the matching currency.
- **SC-005**: Cross-user access to credentials, cache, runs, and trades is blocked.
- **SC-006**: No real-order or reserved-order endpoint exists.
- **SC-007**: Documentation and UI describe KIS, symbol search, TQQQ/005930 examples, and currency handling.
