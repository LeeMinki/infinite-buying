# Implementation Plan: KIS Auto Trading

**Branch**: `005-kis-auto-trading` | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-kis-auto-trading/spec.md`

## Summary

Add user-scoped KIS automatic trading to the existing authenticated app. The backend will add auto-trading persistence, KIS token management, KIS trading account/order operations, a pure auto-trading strategy engine, safety guards, scheduled evaluation, manual evaluation, order refresh, account summary, and dashboard APIs. The frontend will add an auto-trading dashboard, live-order toggle, account summary when live order execution is on, strategy creation/detail screens, and clear status displays. Live orders remain user-controlled and default off; when off, BUY/SELL decisions create internal DRY_RUN records, displayed to users as 모의 주문 기록.

## Technical Context

**Language/Version**: JavaScript on Node.js 22+ backend; React 19-compatible JavaScript frontend
**Primary Dependencies**: Express, better-sqlite3, dotenv, cors, bcrypt, express-session, built-in fetch, node:crypto, Vite, React, Recharts
**Storage**: SQLite with ordered SQL migrations under `backend/src/db/migrations`
**Testing**: Node built-in test runner via `npm test`; frontend production build via `npm run build`
**Target Platform**: Linux server running the existing Node backend and Vite-built React frontend in k3s
**Project Type**: Web application with backend REST routes and React frontend
**Performance Goals**: Dashboard visible under 3 seconds; account summary visible or safely failed under 3 seconds when live order execution is on; start/stop/toggle feedback under 2 seconds; scheduled evaluation must not block normal web requests; RUNNING strategies must log at least once every 10 minutes while the backend is running
**Constraints**: Live orders default disabled; no raw App Secret/access token/account number in browser responses or logs; all records user-scoped; real order path guarded by live setting and safety checks; no automatic retry after order failures
**Scale/Scope**: Single-node deployment, per-user strategies, periodic evaluation of RUNNING strategies, domestic and overseas KIS trading paths

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution file still contains placeholder principles and no enforceable gates. This plan applies the repository's active engineering rules instead:

- User data must remain scoped by authenticated `userId`.
- Secrets, tokens, and account identifiers must be encrypted at rest where persisted and masked in logs/responses.
- Real broker order execution must be explicitly controlled, audited, and blocked by default.
- Existing backend/frontend patterns should be reused instead of introducing new frameworks.
- Tests must cover strategy decisions, safety guards, dry-run/live-order branching, scheduler locking, and user isolation.

Initial gate result: PASS. No known constitutional violation.

## Project Structure

### Documentation (this feature)

```text
specs/005-kis-auto-trading/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── auto-trading-dashboard.md
│   ├── auto-trading-orders.md
│   ├── auto-trading-settings.md
│   └── auto-trading-strategies.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 0017_auto_trading.sql
│   │   └── schema.sql
│   ├── repositories/
│   │   ├── autoTradingRepository.js          # 005의 모든 auto-trading 테이블 (settings, strategies, snapshots, orders, decision logs, locks, daily usages)을 한 repo 모듈에서 처리
│   │   └── kisCredentialsRepository.js
│   ├── routes/
│   │   └── autoTradingRoutes.js              # settings + dashboard + account-summary + strategies + orders를 한 라우터에서 처리
│   ├── services/
│   │   ├── autoTradingScheduler.js
│   │   ├── autoTradingService.js
│   │   ├── autoTradingStrategyEngine.js
│   │   ├── autoTradingSafetyGuard.js
│   │   ├── kisTokenManager.js
│   │   └── kisTradingService.js
│   ├── app.js
│   └── server.js                              # autoTradingScheduler 시작점
└── tests/
    └── autoTrading.test.js                    # token, settings, engine, safety guard, dry-run/live-order 분기, scheduler lock, userId isolation을 한 파일에 통합

frontend/
└── src/
    ├── api/
    │   └── client.js
    └── pages/
        └── AutoTradingPage.jsx                # dashboard + live-order toggle + 전략 폼/목록/상세 + 주문/판단/포지션을 하나의 페이지에서 처리. 보조 UI(LiveOrderToggle 등)는 같은 파일 안에 내부 컴포넌트로 정의.
```

**Structure Decision**: Use the current two-workspace web app layout. Backend follows the existing route/service/repository style and SQLite migration flow. Frontend reuses `StockSearchField` and the current page/component/CSS organization. 005는 도메인이 좁아 repository/route/page를 각 1파일로 합쳐 유지보수를 줄였다.

## Phase 0: Research

See [research.md](./research.md). Key decisions:

- Extend current encrypted KIS credential/token flow into `kisTokenManager` usable by scheduled jobs and request handlers.
- Add `KisTradingService` as a direct KIS trading adapter, not a broker abstraction.
- Keep live order execution default off and store DRY_RUN records without touching KIS order APIs when off.
- Use whole-share automatic live trading quantities for this feature.
- Use strategy-level locks, idempotency keys, open-order checks, and daily usage rows to prevent duplicate or excessive orders.

## Phase 1: Design & Contracts

See:

- [data-model.md](./data-model.md)
- [contracts/auto-trading-settings.md](./contracts/auto-trading-settings.md)
- [contracts/auto-trading-strategies.md](./contracts/auto-trading-strategies.md)
- [contracts/auto-trading-orders.md](./contracts/auto-trading-orders.md)
- [contracts/auto-trading-dashboard.md](./contracts/auto-trading-dashboard.md)
- [quickstart.md](./quickstart.md)

## Architecture

### Backend Flow

1. Auth middleware attaches `userId`.
2. Auto-trading routes scope every request by `userId`.
3. `KisTokenManager` loads encrypted KIS credentials, decrypts App Key/App Secret only in memory, reuses valid encrypted token or issues a fresh token, and returns an in-memory auth context.
4. `KisTradingService` uses the auth context for current price, balance, buying power, open orders, order history, buy order, sell order, and order refresh operations.
5. `AutoTradingService` owns strategy lifecycle, manual evaluation, scheduled evaluation, snapshots, decision logs, orders, and strategy status updates.
6. `autoTradingStrategyEngine` is pure and returns BUY / SELL / HOLD / SKIP with expected order values and reason.
7. `SafetyGuard` blocks unsafe real orders and returns user-readable reasons.
8. `autoTradingScheduler` periodically loads RUNNING strategies, acquires a per-strategy lock, checks market-session safety, and calls scheduled evaluation. Failures are logged as strategy/decision errors without crashing the app.
9. Scheduler interval defaults to 10 minutes (`AUTO_TRADING_SCHEDULER_INTERVAL_MS=600000`) so each RUNNING strategy produces regular decision logs while the backend is alive.

### Frontend Flow

1. Dashboard shows live-order setting, running strategies, recent decisions/orders, error strategies, today's used amount, and latest position snapshots.
2. Live-order toggle writes the setting and immediately displays record mode or live-order mode with order-transmission copy, not backtest warning copy.
3. Whenever a strategy is selected, the page requests a safe account summary and displays buying power, holding quantity, average price, and open-order count without exposing the account number. The same endpoint is used in both record mode and live-order mode so users can verify the KIS connection before enabling real orders; the displayed mode label switches between record and live based on the current setting.
3a. For non-domestic strategies, the page displays a plain-language guide explaining that the broker does not auto-convert the home currency at order time, that integrated-margin or pre-exchange is required, and that all budget/evaluation values are denominated in the symbol's settlement currency. The guide explains the broker's general home-currency↔foreign-currency policy and does not hard-code a specific foreign currency name or phrase it as if specific to one strategy.
3c. The account summary surfaces both `cashAvailable` (current foreign-currency buying power) and `cashAvailableAfterFx` (KIS-calculated buying power after virtually converting the home-currency balance), plus the applied FX rate. When the current foreign-currency buying power is 0 but the after-FX value is positive, the UI explains that integrated-margin enrollment or pre-exchange is needed for the after-FX amount to be usable for automatic orders.
3d. The strategy creation form, after the user selects a symbol, fetches buying-power preview for that symbol/market and offers one-click options to apply the current foreign-currency buying power or the after-FX equivalent to the total budget. Manual input is always allowed and recommended values never auto-overwrite the input.
3b. The strategy list supports a per-row delete action with confirmation. Deleting a RUNNING strategy shows an extra warning that ongoing evaluation will stop and that already submitted broker orders will not be canceled automatically.
3e. The page lays the strategy list out as a horizontal chip group directly above the strategy detail panel. Chips wrap on narrow viewports. The strategy detail panel consumes the full page width like the surrounding panels so its metric grid stays readable.
3f. The strategy creation form uses a balanced grid: the stock-search row spans both columns, the numeric inputs (총 예산, 분할 회차, 목표 수익률) align on the next row, and the submit button anchors a final right-aligned row. The legacy 1회/일일 주문 한도 inputs are removed.
3g. The "최근 포지션 스냅샷" panel surfaces the matching BUY/SELL/HOLD/SKIP/ERROR/COMPLETED label as a decision badge so the user can see at a glance what the strategy decided at that snapshot moment.
4. Strategy form reuses `StockSearchField`, stores symbol/market/currency/name and budget/risk fields.
5. Strategy detail supports start/stop/manual evaluate, status panels, latest snapshot, orders, decisions, and open-order visibility.
6. Decision logs show what the evaluator checked: current price, holding quantity, average price, cash/buying power, current round, open-order count, and live-order setting.
7. Main-screen strategy drafts can seed the backtest and auto-trading forms so users do not re-enter symbol, budget, split count, or target profit rate.

## Data Model Design

SQLite migrations add:

- `user_trading_settings`
- `user_trading_setting_histories`
- `auto_trading_strategies`
- `auto_trading_position_snapshots`
- `auto_trading_orders`
- `auto_trading_decision_logs`
- `auto_trading_locks`
- `daily_order_limit_usages`

Indexes:

- User-scoped indexes on all auto-trading tables.
- Strategy/time indexes for dashboard and detail lists.
- `auto_trading_orders.idempotency_key` unique.
- `daily_order_limit_usages(user_id, strategy_id, trade_date)` unique (per-strategy daily usage; market/currency live as row data).
- `auto_trading_locks(strategy_id, lock_key)` unique so one active lock per (strategy, key) is enforced.

Existing symbol search returns `{ symbol, name, market, exchange, currency }`; strategy creation stores those fields directly.

## KIS Token Manager Design

- Reuse existing encrypted `kis_credentials` rows.
- Load credential by `userId`.
- Decrypt App Key/App Secret only inside token acquisition.
- Reuse memory cache when token expiry is safely beyond the refresh window.
- Reuse encrypted persisted access token when valid.
- Reissue token when missing, expired, or near expiry.
- Persist encrypted access token and `tokenExpiresAt`.
- Return safe errors such as "KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요".
- Never return or log raw token/App Secret/account number.

## KIS Trading Service Design

Use local reference `KIS/한국투자증권_오픈API_전체문서_20260512_030000.xlsx`.

Responsibilities:

- Current price: reuse market data flow where possible.
- Domestic balance: 주식잔고조회.
- Domestic buying power: 매수가능조회.
- Domestic sellable quantity: 매도가능수량조회.
- Domestic order/fill history: 주식일별주문체결조회 and 정정취소가능주문조회 for open-order context.
- Domestic cash order: 주식주문(현금).
- Overseas balance: 해외주식 잔고.
- Overseas buying power: 해외주식 매수가능금액조회.
- Overseas open orders: 해외주식 미체결내역; for unsupported cases, derive from 해외주식 주문체결내역 where needed.
- Overseas order/fill history: 해외주식 주문체결내역.
- Overseas order: 해외주식 주문.

Standard responses:

- `currentPrice`: symbol, market, currency, exchange, price, fetchedAt.
- `position`: quantity, sellableQuantity, averagePrice, evaluationAmount, unrealizedProfit, unrealizedProfitRate.
- `buyingPower`: cashAvailable, buyingPower, maxBuyQuantity, currency.
- `openOrders`: orderNo, originalOrderNo, side, quantity, filledQuantity, remainingQuantity, orderPrice, status.
- `orderResult`: broker order number, original number, status, accepted/rejected message, masked request/response metadata.
- `buyingPower` (overseas) also surfaces `cashAvailableAfterFx`, `buyableQuantityAfterFx`, and `exchangeRate` from KIS `echm_af_ord_psbl_amt`, `echm_af_ord_psbl_qty`, `exrt`. These let the UI distinguish "외화 잔고로 바로 살 수 있는 금액" vs "원화를 환전하면 살 수 있는 금액" without re-querying KIS.

### Rate limit handling

KIS는 계정별 초당 거래건수 제한이 있어 같은 초에 호출이 몰리면 `EGW00201 초당 거래건수를 초과하였습니다` 가 반환된다. `KisTradingService.requestJson`은 사용자별로 호출 사이 최소 간격(기본 220ms)을 강제하고, EGW 계열/429/5xx 같은 일시 오류는 400ms→900ms→1800ms backoff 로 최대 3회 재시도한다. 주문(POST) API는 멱등성 보장이 어려워 재시도하지 않는다. `AutoTradingService.getAccountSummary` 같이 한 화면에 KIS 호출이 몇 건 같이 필요한 경우에는 `Promise.all` 대신 순차 await 으로 burst 를 줄인다.

## StrategyEngine Design

Pure function input:

- `symbol`
- `market`
- `currency`
- `currentPrice`
- `holdingQuantity`
- `averagePrice`
- `cashAvailable`
- `currentRound`
- `totalBudget`
- `splitCount`
- `targetProfitRate`

Pure function output:

- `decision`: BUY / SELL / HOLD / SKIP
- `expectedQuantity`
- `expectedOrderPrice`
- `expectedAmount`
- `reason`
- `nextRoundHint`

Rules:

- SELL if holding quantity > 0 and current price >= average price × (1 + target profit rate).
- SELL targets full available holding quantity.
- Otherwise compute `rawQuantity = (totalBudget / splitCount) / current price`. For domestic (KR) symbols floor to whole shares; for non-domestic symbols keep up to 6 decimal places so a per-round budget smaller than one share's price still produces a BUY decision rather than perpetual HOLD.
- BUY when the resulting quantity is positive and matches cash availability.
- HOLD if the quantity rounds to zero or cash is insufficient.
- HOLD if max split rounds are used and no SELL condition exists.
- No DB, HTTP, KIS, logging, or time dependencies inside the function.

SafetyGuard takes care of enforcing whole-share submission for the KIS standard overseas order endpoint when live-order mode is on, so the engine itself stays free of broker-specific rounding.

## SafetyGuard Design

Inputs:

- Strategy
- Decision
- Live-order setting
- Latest KIS position and buying power
- Open orders
- Existing auto-trading orders for duplicate detection
- Daily order usage

Checks:

1. Strategy status is RUNNING.
2. Decision is BUY or SELL; HOLD/SKIP never proceeds to order.
3. Quantity is positive.
4. No open KIS order for the symbol/strategy context.
5. No duplicate same strategy/date/side/decision/idempotency key.
6. BUY has enough buying power.
7. SELL has enough sellable quantity.
8. `liveOrderEnabled=false` returns DRY_RUN outcome before any real-order path.
9. `liveOrderEnabled=true` allows real-order request only when all checks pass.

The legacy per-order and daily order limits (`maxOrderAmount`, `maxDailyOrderAmount`) are no longer checked here. They were noisy for users and the natural KIS account capacity check is enough for the MVP.

Additionally, when live-order mode is on and the strategy market is non-domestic, SafetyGuard blocks real-order submission if the calculated BUY quantity is less than one whole share, because the standard KIS overseas order endpoint accepts only integer share counts. DRY_RUN orders keep the fractional quantity so the user can see what the strategy would have done.

Blocked orders become SKIP logs with reason. DRY_RUN orders are stored as `DRY_RUN`.

## AutoTradingService Design

Lifecycle:

- Create strategy in CREATED.
- Start CREATED/STOPPED strategy: set RUNNING, startedAt, clear stoppedAt/error fields.
- Stop RUNNING/ERROR strategy: set STOPPED and stoppedAt; do not cancel orders.
- Manual evaluate: user-triggered evaluation of current strategy, using same safety path.
- Scheduled evaluate: background evaluation of RUNNING strategy, with lock and market-session SKIP logic.

Evaluation steps:

1. Load user setting and strategy.
2. Acquire token through `KisTokenManager`.
3. Load current price, position, buying power, open orders.
4. Save position snapshot.
5. Run pure strategy engine.
6. Save decision log.
7. For BUY/SELL, run `SafetyGuard`.
8. If live orders disabled, save DRY_RUN order.
9. If enabled and allowed, save REQUESTED order, call KIS order, then update ACCEPTED/REJECTED/FAILED.
10. Update daily usage only for accepted/filled real orders or chosen accepted state; keep deterministic in implementation.
11. Update strategy currentRound, lastEvaluatedAt, lastOrderAt, lastDecision, lastErrorMessage.
12. Do not auto-retry failed orders.

## Scheduler Design

- Starts with backend process unless explicitly disabled by environment.
- Interval chosen in implementation with a conservative default; user prompt did not require a specific cadence.
- Loads RUNNING strategies only.
- Uses `auto_trading_locks` to skip strategies already being evaluated.
- Treats unknown market session status as SKIP.
- Uses KIS Token Manager to refresh/issue tokens without user session activity.
- Catches per-strategy errors and records ERROR/SKIP decisions instead of exiting.
- Leaves STOPPED strategies untouched.

## API Design

Contracts are documented under `contracts/`.

Route groups:

- `/api/auto-trading/settings`
- `/api/auto-trading/strategies`
- `/api/auto-trading/orders`
- `/api/auto-trading/dashboard`
- `/api/auto-trading/account-summary` (선택 전략 기준 KIS 잔고/매수가능금액 조회. 실주문 토글 무관 항상 호출 가능)
- `/api/auto-trading/buying-power-preview` (전략 만들기 화면에서 시장/심볼만으로 KIS 매수가능금액과 환전 후 매수가능금액을 미리 받아 추천 총 예산 버튼을 노출)

Common response rules:

- All protected by auth.
- All data scoped by `req.userId`.
- Not-found is returned for missing or other-user records.
- Errors use `{ "error": "safe message" }`.
- Secret/token/account raw values never returned.

## Frontend Design

Pages:

- Auto-trading dashboard.
- Auto-trading strategy creation/edit.
- Auto-trading strategy detail.

Controls:

- Live-order toggle with explicit off/on wording.
- Existing stock search field.
- Start/stop/manual evaluate buttons.
- Risk notice near live toggle and strategy execution controls.

Displays:

- Strategy status and last decision.
- Current price, holding quantity, average price, cash, evaluation amount.
- Open orders and order history.
- Decision log table.
- Position snapshot panel.
- Dashboard counts and error cards.

## Test Strategy

Backend tests:

- `KisTokenManager` valid cache, near-expiry refresh, expired token, issue failure.
- User trading setting toggle and history.
- Pure auto-trading strategy engine BUY/SELL/HOLD/SKIP paths.
- SafetyGuard unit tests for open order, duplicate, max order amount, daily limit, insufficient buying power, insufficient sellable quantity, zero quantity.
- DRY_RUN path proves no real-order service method is called.
- live-order path uses mocked KIS order service and records order result.
- UserId isolation for settings, strategies, orders, decisions, positions.
- Scheduler lock prevents concurrent double order.
- Order refresh maps partial/full fills and unknown states.

Frontend/build tests:

- `npm run build` must pass.
- Manual smoke: login, KIS settings present, auto-trading dashboard opens, create strategy from stock search, toggle live setting, start/stop, manual evaluate.

## Post-Design Constitution Check

Result: PASS.

- No new framework introduced.
- Secrets/tokens/account values remain masked or encrypted.
- Live order execution defaults off and is gated by user setting plus safety checks.
- UserId scoping is part of every data model and contract.
- Tests cover the high-risk financial and concurrency paths.

## Complexity Tracking

No constitution violations requiring exceptions.
