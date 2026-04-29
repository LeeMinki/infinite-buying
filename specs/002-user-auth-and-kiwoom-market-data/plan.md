# Implementation Plan: Multi-User Auth and Per-User Kiwoom Market Data

**Branch**: `002-user-auth-and-kiwoom-market-data` | **Date**: 2026-04-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/home/hyerin/speckit/infinite-buying/specs/002-user-auth-and-kiwoom-market-data/spec.md`

## Summary

Add fast-MVP email/password authentication, strict per-user data isolation, and per-user Kiwoom REST market-data integration to the existing virtual trading MVP. The browser talks only to the Express backend with an httpOnly session cookie. The backend owns password hashing, credential encryption, Kiwoom token issuance/cache, current-price lookup, daily OHLCV lookup, and per-user SQLite cache writes. The frontend never calls Kiwoom directly and never receives a Secret Key, access token, plaintext password, or unmasked App Key. Existing manual current-price evaluation remains available when Kiwoom fails.

## Technical Context

**Language/Version**: JavaScript on Node.js 22+ for backend; React 19-compatible JavaScript frontend.
**Primary Dependencies**: Express, better-sqlite3, dotenv, cors, Vite, React, Recharts. Add backend dependencies: `bcrypt`, `express-session`, `better-sqlite3-session-store`. Use built-in `node:crypto` for AES-256-GCM encryption.
**Storage**: SQLite on the EC2/k3s backend volume. Existing `app.db` keeps application data; session rows use a separate SQLite-backed session store file or table.
**Testing**: Node built-in `node:test` for backend unit/integration tests; Vite production build plus grep-based bundle audit for frontend secret exposure.
**Target Platform**: Single EC2 instance running k3s, Traefik, cert-manager, backend/frontend containers, public URL `https://infinite-buying.yuna-pa.com/`.
**Project Type**: Web application with `backend/`, `frontend/`, and `infra/` directories.
**Performance Goals**: Current price returns within 3 seconds median under normal Kiwoom availability; first six-month daily chart load returns within 5 seconds median; repeated cached daily chart load returns within 1 second median.
**Constraints**: No real order API or Kiwoom order endpoint; frontend does not call Kiwoom; no password/App Key/Secret Key/access token in logs, responses, or bundle; Secret Key and access token encrypted at rest; App Key displayed only masked; every data read/write scoped by session userId; no `DEFAULT_USER_ID`; manual price input fallback remains.
**Scale/Scope**: Small MVP with single-digit concurrent users, one Kiwoom credential per user, SQLite storage, and per-user daily cache keyed by `(user_id, stock_code, date)`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The repository constitution is still the unfilled template, so there are no ratified project-wide gates. This plan uses the user-provided constraints and `AGENTS.md` manual additions as binding gates:

| Gate | Pre-design status | Post-design status |
|---|---|---|
| No real broker order APIs | PASS: feature only covers market data | PASS: contracts define auth/settings/market routes only; no order route to Kiwoom |
| User data isolation | PASS: spec requires session-bound userId | PASS: data model adds owner fields and contracts require repository scoping |
| Secrets stay backend-only | PASS: spec forbids frontend/log exposure | PASS: contracts return masked App Key only; encryption/log redaction defined |
| No `DEFAULT_USER_ID` workaround | PASS: explicit constraint | PASS: migration uses seed owner only for existing rows; runtime always uses session user |
| Manual current-price fallback | PASS: existing UI supports manual input | PASS: frontend plan keeps manual input and adds Kiwoom lookup as additive control |
| PR workflow | PASS: no direct main push in this plan | PASS: implementation will use feature branch and PR |

**Gate result**: PASS. No complexity exceptions are required.

## Architecture

```text
Browser (React)
  | same-origin fetch, credentials: include
  v
Express backend
  | session cookie -> users/session store -> req.userId
  | repositories always receive userId
  | KiwoomAuthService decrypts user's keys and issues/caches token
  v
SQLite
  - users
  - sessions
  - strategies / holdings / virtual_orders / decision_logs with user_id
  - kiwoom_credentials with encrypted app/secret/token fields
  - market_price_cache unique(user_id, stock_code, date)

Express backend
  | outbound HTTPS from EC2 public IP
  v
Kiwoom REST API
```

The Kiwoom site must allowlist the backend server's outbound public IP, not the user's browser IP, because every Kiwoom REST call is made by the EC2 backend. Browser requests terminate at the app backend; the browser never contacts Kiwoom and therefore the user's PC IP is irrelevant to Kiwoom's IP whitelist.

## Project Structure

### Documentation (this feature)

```text
specs/002-user-auth-and-kiwoom-market-data/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── auth.md
│   ├── kiwoom-settings.md
│   ├── market.md
│   └── strategies-userid.md
└── tasks.md              # created later by /speckit.tasks
```

### Source Code (repository root)

```text
backend/
├── package.json                  # add bcrypt/session dependencies
├── src/
│   ├── app.js                    # mount auth/settings routes and session middleware
│   ├── server.js                 # startup env validation
│   ├── config/env.js             # add auth, encryption, Kiwoom, EC2 IP values
│   ├── db/
│   │   ├── migrate.js            # ordered migration runner
│   │   └── migrations/           # users, user_id, credentials, cache migrations
│   ├── auth/                     # password hashing, session store, middleware, service
│   ├── crypto/                   # encryptSecret/decryptSecret, maskAppKey, redaction
│   ├── repositories/             # user-scoped repositories
│   ├── services/                 # auth, strategies, Kiwoom credential/auth/market services
│   ├── market-data/              # stateless Kiwoom provider + mock provider
│   └── routes/                   # auth, settings, market, scoped strategy/order routes
└── tests/
    ├── auth.test.js
    ├── crossUserIsolation.test.js
    ├── kiwoomCredential.test.js
    ├── kiwoomAuthService.test.js
    └── marketRoutes.test.js

frontend/
└── src/
    ├── App.jsx                   # auth-gated app shell
    ├── api/client.js             # credentials: include and 401 handling
    ├── auth/                     # AuthContext, LoginPage, RegisterPage
    ├── pages/                    # KiwoomSetupPage + existing pages
    └── components/               # DailyChart and EvaluationPanel wiring
```

**Structure Decision**: Keep the existing web-app split. Backend follows the current route → service → repository shape; frontend adds a small auth shell instead of introducing a router unless implementation shows the existing view state is too brittle.

## Phase 0 Research Decisions

See [research.md](./research.md). Key decisions:

- `bcrypt` with cost 12 for password hashes.
- Server-side sessions with httpOnly, SameSite=Lax cookies; Secure in production.
- AES-256-GCM with a base64 32-byte `SECRET_ENCRYPTION_KEY`.
- Structured redaction wrapper for logs.
- `KiwoomAuthService` owns per-user token issuance/cache; provider becomes stateless.
- Per-user `market_price_cache` keyed by `(user_id, stock_code, date)`.
- Existing pre-auth data must be explicitly backfilled to a seed owner or removed during migration.

## Phase 1 Design Decisions

### Authentication

- `users` table stores lowercased email and bcrypt password hash.
- `express-session` stores a server-side session and sends only `ib.sid` httpOnly cookie to the browser.
- `requireAuth` rejects unauthenticated protected routes with `401`.
- Login failures use one generic message for unknown email and wrong password.
- `/api/auth/me` returns only `{ id, email }`.

### Existing Data Migration

- Add `user_id` to `strategies`, `holdings`, `virtual_orders`, and `decision_logs`.
- If production tables contain existing rows, the migration requires `SEED_OWNER_USER_ID` or a deliberate wipe step before enabling multi-user auth.
- Runtime code never uses a default user; the seed owner exists only to make old data legal and owned.
- Cross-user access returns not-found style responses, not forbidden responses.

### Kiwoom Credentials and Encryption

- `kiwoom_credentials` stores one row per user.
- `app_key_masked` is display-only.
- `app_key_encrypted`, `secret_key_encrypted`, and optional `token_encrypted` use AES-256-GCM.
- `token_expires_at`, `status`, `last_token_issued_at`, and `last_token_error_message` drive the setup UI.
- Backend refuses startup if `SECRET_ENCRYPTION_KEY`, `SESSION_SECRET`, `EC2_ELASTIC_IP`, `KIWOOM_API_BASE_URL`, `KIWOOM_MOCK_API_BASE_URL`, or `ENABLE_LIVE_ORDER` is missing; live order must remain false.

### Kiwoom Token and Market Data

- `KiwoomAuthService` decrypts user keys only inside backend memory, reuses valid cached tokens, reissues on expiry or Kiwoom token rejection, and retries once.
- Token failures produce sanitized Korean messages and mention EC2 Elastic IP registration when likely.
- `KiwoomMarketDataProvider` normalizes current price and daily OHLCV responses into app-internal shapes.
- Daily data is upserted into SQLite with `unique(user_id, stock_code, date)`.
- Frontend receives `source: KIWOOM | CACHE | MOCK` but never token/key material.

### Frontend

- Add registration and login screens.
- Add logout control and auth bootstrap using `/api/auth/me`.
- Add Kiwoom Setup page with EC2 Elastic IP guide, environment selector, masked App Key view, save/delete/test actions.
- Add "현재가 조회" to strategy detail and keep manual price input.
- Wire daily chart to backend daily endpoint using existing Recharts component.

## API Contracts

Contracts are generated under [contracts/](./contracts/):

- [Auth API](./contracts/auth.md)
- [Kiwoom Settings API](./contracts/kiwoom-settings.md)
- [Market API](./contracts/market.md)
- [Per-user Strategy/Order/Log Scoping](./contracts/strategies-userid.md)

## Testing Strategy

- Auth integration: register, login, me, logout, duplicate email, generic login failure.
- Cross-user isolation: two cookie jars; one user's strategies/holdings/orders/logs invisible and unreachable to another.
- Secret/token exposure: API response audit for auth/settings/market; built frontend bundle grep for secret names and known key values.
- Kiwoom mock tests: mocked `fetch` for token success, expiry, invalid token retry, network failure, malformed body.
- Market cache tests: first daily request writes rows, second serves cache, uniqueness query returns no duplicates.
- Fallback test: invalid/missing Kiwoom credential leaves manual current-price evaluation usable.
- Route inventory check: no Kiwoom order endpoint exists.

## Implementation Sequence

1. Add env validation, bcrypt/session dependencies, session store, auth middleware, users repository/service/routes, and auth tests. Keep existing routes public until user_id migration is ready.
2. Add migrations for `users` and `user_id` columns. Backfill existing data through an explicit seed owner or wipe path. Then protect existing strategy/order/market routes and pass `req.userId` through repositories.
3. Add cross-user isolation tests and update repositories/services until every protected endpoint scopes by session user.
4. Add AES-GCM helper, masking/redaction helper, `kiwoom_credentials` table, settings routes, and credential masking/exposure tests.
5. Refactor Kiwoom token issuance into `KiwoomAuthService`; add token cache, expiry/reissue, sanitized failure messages, and mocked token tests.
6. Refactor market data provider to accept per-user token supplier; update current price endpoint and preserve manual fallback UI.
7. Replace daily cache with per-user cache, implement daily range fetch/upsert/cache merge, and add market route tests.
8. Add frontend auth shell, login/register/logout, and protected screen handling.
9. Add Kiwoom Setup page with EC2 Elastic IP instructions, save/delete/test actions, and no secret echoing.
10. Wire strategy detail "현재가 조회" and daily chart to new backend endpoints.
11. Run full backend tests, frontend build, bundle secret audit, route inventory, and manual quickstart on deployed environment.

This order keeps the app functional after each backend slice: authentication lands first, then data ownership, then credential storage, then Kiwoom read-only market data, then UI wiring.

## Deferred Follow-Up Specs

- Backtesting engine and backtest result storage.
- Backtest reports and report UI.
- Paper-trading hardening beyond the existing virtual-order MVP.
- Any Kiwoom live order integration. This remains explicitly out of scope for this feature.

## Complexity Tracking

No constitution violations or complexity exceptions. The feature adds necessary auth/session/encryption modules because the security and per-user isolation requirements cannot be met with the existing unauthenticated 001 MVP structure.
