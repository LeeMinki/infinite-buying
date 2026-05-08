# Research: Infinite Buying Strategy Assistant MVP

## Decision: JavaScript-first React + Node.js implementation

**Rationale**: The user explicitly requested JavaScript priority, React frontend, and Node.js + Express backend. This is the fastest path for a local web MVP because both UI and API can share simple JSON contracts and use one runtime ecosystem.

**Alternatives considered**: TypeScript was deferred to avoid setup overhead. A single full-stack framework was rejected because the requested API list and provider boundary are clearer with an explicit Express backend.

## Decision: Use better-sqlite3 for SQLite

**Rationale**: The MVP is local and single-user. `better-sqlite3` keeps database access synchronous and simple, supports transactions directly, and reduces callback/promise plumbing around write consistency for virtual order fills.

**Alternatives considered**: `sqlite3` is workable but slower to implement cleanly because its async callback API adds noise. ORMs were rejected for MVP speed and because the schema is small.

## Decision: Use Recharts for charts

**Rationale**: Recharts is fast to wire into React for line and bar charts. The MVP only needs daily price display, not advanced trading-chart interactions.

**Alternatives considered**: Chart.js is also viable, but Recharts maps more directly to React components. Lightweight Charts was deferred because candlestick fidelity is not needed for the first MVP.

## Decision: Market data is accessed through a provider interface

**Rationale**: Kiwoom credentials may be unavailable during initial implementation, and Kiwoom response shape can differ by TR. A `MarketDataProvider` interface let the first MVP isolate market-data access while Kiwoom read-only integration was added behind the same methods. Current implementation uses Kiwoom only.

**Alternatives considered**: Direct Kiwoom calls from route handlers were rejected because they would couple UI-critical flows to credentials and make fallback behavior harder to test.

## Decision: Kiwoom REST API is read-only in MVP

**Rationale**: Official Kiwoom REST docs identify OAuth token issuance through `POST /oauth2/token` with app key and secret key, production domains, market-data categories, stock basic info `ka10001`, and daily chart `ka10081`. The same menu also lists stock order TRs such as `kt10000` through `kt10003`; these are explicitly excluded from this MVP.

**Alternatives considered**: Live order integration and account-balance integration were rejected because the feature scope requires virtual orders only.

## Decision: Current market data uses Kiwoom only

**Rationale**: The success condition requires manual fallback when current-price lookup fails. The current app uses backend-only Kiwoom market data and keeps manual current-price input as the fallback.

**Alternatives considered**: Blocking the MVP on Kiwoom credentials was rejected because it slows delivery and does not improve the virtual-order workflow.

## Decision: Strategy math lives in a pure function

**Rationale**: BUY / SELL / HOLD / PAUSE rules are the highest-risk behavior. A pure function can be tested without HTTP, SQLite, or provider dependencies.

**Alternatives considered**: Embedding decision logic inside route handlers or repositories was rejected because it makes duplicate BUY, holding updates, and edge cases harder to test.

## Decision: Duplicate BUY prevention is enforced in application code and SQLite

**Rationale**: The feature explicitly requires no duplicate BUY for the same strategy, date, and round. Service logic gives a clear user-facing reason, while a partial unique index protects against accidental duplicate writes.

**Alternatives considered**: Application-only prevention was rejected because it is weaker during retries or concurrent requests.
