# Phase 0 Research: Multi-User Auth and Per-User Kiwoom Market Data

**Feature**: 002-user-auth-and-kiwoom-market-data
**Date**: 2026-04-29
**Purpose**: Resolve all open technology and integration questions surfaced by the spec, so Phase 1 (data-model, contracts, quickstart) and Phase 2 (tasks) can proceed without `[NEEDS CLARIFICATION]` markers.

The user-supplied brief was already prescriptive (bcrypt, Node `crypto`, session/httpOnly cookie, SQLite, Recharts, no real orders). This document records each decision, why it was chosen over alternatives, and the operational consequences.

---

## 1. Password hashing

**Decision**: `bcrypt` (the `bcrypt` npm package, not bcryptjs) with `cost = 12`.

**Rationale**:
- The brief mandates "bcrypt 사용".
- `bcrypt` (native) is faster than `bcryptjs` and adequate for our scale (single-digit concurrent users, login is rare).
- Cost 12 ≈ ~250 ms on EC2 t3-class hardware — slow enough to deter brute force, fast enough that a real user does not notice on login.
- bcrypt embeds the salt and cost factor in the hash string, so we store one column (`password_hash TEXT NOT NULL`) and don't need a separate salt column.

**Alternatives considered**:
- **Argon2id** (`argon2` package): theoretically stronger memory-hard PBKDF, but adds a native build step and Argon2's tuning surface (memory cost, parallelism) is overkill for a small MVP. Reject.
- **scrypt** (Node built-in): viable, no extra dependency, but bcrypt has more battle-testing in Node web stacks and the brief explicitly named bcrypt. Reject.
- **bcryptjs** (pure-JS): slower under load, but works on machines without a C++ toolchain. EC2 already builds better-sqlite3 natively, so the toolchain is present. Reject.

**Operational consequences**:
- Add `bcrypt` to `backend/package.json`. Native binary is built on `npm install`; the existing Dockerfile already installs build-essential for `better-sqlite3`, so no Dockerfile change is needed beyond the npm install line.
- A future cost bump (12 → 13 in 2-3 years) is a one-line change; old hashes still validate because bcrypt embeds the cost.

---

## 2. Session vs JWT

**Decision**: Server-side sessions stored in SQLite, exposed to the browser as an httpOnly, SameSite=Lax (Secure in production) cookie. Library: `express-session` + `better-sqlite3-session-store`.

**Rationale**:
- The spec brief explicitly says "session 또는 httpOnly cookie 기반 인증" and the security FRs (FR-007, FR-032) forbid putting any token-bearer secret in the frontend.
- Server-side sessions give us **immediate logout** (delete the session row) — JWTs cannot be revoked without a separate denylist, which adds complexity for no MVP gain.
- We're already running SQLite for everything else; another small SQLite file (`data/sessions.db`) keeps the ops model uniform. No Redis required.
- httpOnly cookies are not readable by JavaScript, so a successful XSS cannot steal the session cookie out-of-band.

**Cookie attributes** (production):
- `httpOnly: true`
- `secure: true` (the deployment is HTTPS-only via nginx + ACME)
- `sameSite: 'lax'` (the frontend and backend share an origin, so we don't need `'none'`; lax also blocks CSRF on top-level cross-site POSTs)
- `maxAge: 1000 * 60 * 60 * 24 * 14` (14 days idle), `rolling: true` so any request re-extends the window
- Session secret sourced from `SESSION_SECRET` (≥ 32 chars; backend refuses to start otherwise)

**Alternatives considered**:
- **JWT in localStorage**: vulnerable to XSS exfil. Reject.
- **JWT in httpOnly cookie**: same revocation problem as bearer JWT. Reject.
- **`iron-session`** (cookie-encrypted state): no server-side row, so cross-tab logout would require client coordination. Reject for MVP.

**Operational consequences**:
- Add `express-session` and `better-sqlite3-session-store` (or `connect-better-sqlite3`) to deps.
- Sessions table is auto-created by the store; a small extra DB file lives alongside `app.db` so production backups should pick it up.
- CSRF: with same-origin frontend/backend and `SameSite=Lax`, CSRF on state-changing endpoints is mitigated by the cookie attribute itself. We will not add a CSRF token library for MVP. (Documented as a known follow-up if cross-origin frontend ever becomes a thing.)

---

## 3. Encryption for App Key / Secret Key / cached Access Token

**Decision**: AES-256-GCM via Node's built-in `node:crypto`. One symmetric key sourced from `SECRET_ENCRYPTION_KEY` (must be exactly 32 bytes after base64-decode). Each ciphertext is stored as `base64(iv) + ':' + base64(authTag) + ':' + base64(ciphertext)`.

**Rationale**:
- The brief says "Node crypto 사용".
- AES-GCM provides authenticated encryption — we get confidentiality and integrity in one primitive.
- 96-bit random IV per encryption (recommended for GCM) — generated with `crypto.randomBytes(12)`.
- Storing the IV and auth tag alongside the ciphertext means decryption is self-contained; the only secret outside the DB is `SECRET_ENCRYPTION_KEY`.
- A single key is enough for MVP; per-user envelope encryption (KMS-style) is overkill at our scale.

**Key format**:
- `SECRET_ENCRYPTION_KEY` env var holds a base64-encoded 32-byte key (44 chars).
- On startup, the backend decodes it; if the result is not exactly 32 bytes, the process refuses to boot. This satisfies FR-014 ("MUST refuse to start if that environment value is missing or weak").
- A dev key (e.g., `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) is documented in `quickstart.md`.

**Alternatives considered**:
- **AES-256-CBC + HMAC-SHA256**: viable but two primitives to combine; people frequently get the encrypt-then-MAC ordering wrong. Reject.
- **libsodium / `tweetnacl`**: nicer API but adds a dependency for what `node:crypto` already does. Reject (also: brief says Node crypto).
- **Per-user derived keys via HKDF**: reasonable hardening but unnecessary for MVP — single key is fine when the threat is DB exfil, since DB exfil without the key still leaves ciphertext.

**Operational consequences**:
- `SECRET_ENCRYPTION_KEY` is a deployment secret. It MUST NOT be the same value as `SESSION_SECRET`. It MUST NOT be checked into git. It MUST be present in the EC2 environment file (e.g., systemd unit's `EnvironmentFile=`) and rotated by re-encrypting all stored ciphertexts (a future operational task — out of MVP scope).
- Rotating the key requires reading every encrypted column, decrypting with the old key, and re-encrypting with the new — documented as a follow-up runbook.

---

## 4. Logging redaction

**Decision**: A small `logger` wrapper that auto-redacts `password`, `appKey`, `secretKey`, `accessToken`, `token`, `Authorization` keys whenever an object is logged. Plus a hard rule: never `console.log(req.body)` in route handlers.

**Rationale**:
- FR-033 forbids raw passwords/keys/tokens in logs.
- Redaction at the logger layer is more robust than relying on every developer to remember.

**Approach** (kept simple — no pino):
- `backend/src/lib/logger.js` exports `info`, `warn`, `error` functions that walk the args, deep-clone any object, and replace flagged keys with `'[REDACTED]'`.
- Express access logging from `cors`/`express` defaults stays disabled in production for credential-bearing routes; we'll log only `{userId, route, status}` on auth-related endpoints.

**Alternatives considered**:
- **`pino` with redact paths**: better for production-grade logging, but the MVP can defer the dependency. We'll keep the wrapper compatible so a future swap to pino is mechanical.

---

## 5. Kiwoom token lifecycle (per-user)

**Decision**: A `KiwoomAuthService` keyed by `userId` that:
1. Looks up the user's KiwoomCredential, decrypts the App Key + Secret Key.
2. If a cached token exists in memory **and** in the `kiwoom_credentials` row's `token_encrypted` field **and** is at least 60 s away from `token_expires_at`, returns it.
3. Otherwise calls Kiwoom's `/oauth2/token` with `grant_type=client_credentials`, `appkey`, `secretkey`, encrypts the returned token, stores it on the row, and returns it.
4. On any 401 from Kiwoom, attempts a single re-issuance and retries the call once.
5. On final failure, returns a sanitized error: `"Kiwoom 인증에 실패했어요. 키움 사이트에 EC2 Elastic IP가 등록되어 있는지 확인해 주세요."` (constructs the IP from `env.EC2_ELASTIC_IP`).

**In-memory cache shape**:
```text
Map<userId, { token, expiresAtMs }>
```
The map is process-local. On process restart, we re-hydrate from `token_encrypted` if it has not expired; otherwise we re-issue on demand. This handles the dev-restart case without forcing the user to wait through a re-issue.

**Existing code reuse**: The 001 MVP's `backend/src/market-data/KiwoomMarketDataProvider.js` already has a `getAccessToken()` method and a token cache, but they're keyed off env-level singleton credentials. The refactor:
- Extract token issuance + cache from `KiwoomMarketDataProvider` into `KiwoomAuthService`.
- `KiwoomMarketDataProvider` becomes stateless: takes a `baseUrl` and a `tokenSupplier: () => Promise<string>` at construction time.
- `marketDataService.getCurrentPrice(userId, stockCode)` builds a per-user provider via `KiwoomAuthService.getTokenSupplier(userId)`.

**Failure-message mapping** (FR-022, FR-018):
| Kiwoom return_msg / HTTP | User-facing message | Persisted status |
|---|---|---|
| 401, "invalid app key", "invalid secret" | "App Key 또는 Secret Key가 올바르지 않아요. 다시 입력해 주세요." | TOKEN_ERROR |
| 401 with IP whitelist hint, 403 | "Kiwoom 사이트에 EC2 Elastic IP `<ip>` 가 등록되어 있는지 확인해 주세요." | TOKEN_ERROR |
| Network/timeout | "Kiwoom 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." | TOKEN_ERROR |
| Success | (none) | TOKEN_VALID |

The exact Kiwoom error shapes are not 100 % stable in their docs, so the auth service falls back to "Kiwoom 사이트에 EC2 Elastic IP `<ip>` 가 등록되어 있는지 확인해 주세요." for any non-401-credential error, since IP misregistration is by far the most common first-time-user failure for this app.

**Alternatives considered**:
- **Reissue token on every request**: trivially correct but wastes Kiwoom token quota. Reject.
- **Pre-warm tokens on credential save**: nice UX but couples credential save to a slow network call. We achieve the same effect with the `연결 테스트` button on save. Reject.

---

## 6. Market data caching

**Decision**: One row per `(user_id, stock_code, date)` in `market_price_cache`. `INSERT … ON CONFLICT(user_id, stock_code, date) DO UPDATE` to upsert. Daily endpoint logic:
1. Compute the requested `[from, to]` range (default = last 6 months ending today, in KST trading days).
2. Read existing user-scoped rows for that stock/date range.
3. If the stored rows do not cover the range, call Kiwoom for the full range and upsert the returned rows with `source='KIWOOM'`.
4. Return the stored set sorted ascending by date.

**Why per-user cache, not global**:
- The brief explicitly mandates per-user cache (`stockCode + date + userId unique 처리`).
- Different users own different credentials and stored price rows, so keeping prices user-scoped avoids cross-account leakage.
- The cost (a tiny duplication for popular stocks) is negligible at MVP scale.

**Why upsert overwrites OHLCV**:
- Recent days can change after-hours (split adjustments, late corrections). Always trusting the freshest fetch is simpler than versioning.

**Alternatives considered**:
- **Cache only "completed" days**: would require tracking trading-calendar metadata. Overkill for MVP.
- **Skip cache entirely**: hits Kiwoom's rate limit faster and breaks SC-005's 1 s cached re-load. Reject.

---

## 7. Existing-data migration

**Decision**: Treat the production database as **pre-multi-user**: on first deploy of this feature, all existing rows get re-owned by a single seed admin user (the operator's account), or are wiped during a planned downtime window if the operator prefers a clean slate.

**Mechanism**:
- Migration `0002_userid_on_existing.sql`:
  1. Adds `user_id INTEGER` (nullable) column to `strategies`, `holdings`, `virtual_orders`, `decision_logs`.
  2. Backfills `user_id` to a seed user id (read from a one-time `SEED_OWNER_USER_ID` env var, **not** baked into the migration). If the env var is not set and the table is non-empty, the migration aborts with a clear error.
  3. Once backfilled, makes `user_id NOT NULL` and adds the foreign-key index.
- The seed admin user is created either via a manual `node scripts/createSeedUser.js admin@... password` script (added in a small later task) or directly via the registration endpoint before the migration runs.

**Why not just drop the data**:
- The deployed app already has the operator's own strategies. Wiping is a strictly larger blast radius than backfilling; we offer it as an option but make it explicit, not default.

**Operational consequences**:
- Operator must register their seed user **before** running the migration.
- The migration script is idempotent (`IF NOT EXISTS` on the column add; backfill is gated by null check).
- Holdings, virtual_orders, and decision_logs all foreign-key to `strategies`, so we additionally enforce isolation by joining through `strategies.user_id` in repositories — the `user_id` column on the child tables is a denormalized convenience for fast scoped queries, not a separate authority.

---

## 8. Frontend auth gating

**Decision**: A small React `AuthContext` that:
1. On app boot, calls `GET /api/auth/me`. If the response is 401, set `user = null`. If 200, set `user = { id, email }`.
2. Wraps the entire app shell. When `user === null`, render `<LoginPage />` / `<RegisterPage />` instead of the existing strategies UI.
3. Provides `login(email, password)`, `register(email, password)`, `logout()` actions that call the backend, then refresh `me`.

**API client adjustment**: `frontend/src/api/client.js` adds `credentials: 'include'` on every fetch (so the session cookie is sent same-origin) and treats any 401 as "session expired → clear user, show login".

**Why not React Router**: 001 MVP doesn't use a router, and adding one for two extra screens (Login, Register, Setup) is heavier than a 3-state shell. We'll use a small in-state `view` switch (`'strategies' | 'kiwoom-setup'`) until growth justifies a real router.

**Alternatives considered**:
- **NextAuth / Clerk / Auth0**: not justified for MVP. Reject.
- **Magic link / email OTP**: nice UX but requires email infrastructure that's out of scope. Reject (per brief).

---

## 9. Charting library

**Decision**: Reuse Recharts 2 (already in `frontend/package.json`). The 001 MVP's `DailyChart.jsx` already renders an AreaChart from a `data` prop of `{ date, close, open, high, low, volume }` rows. Wiring it to the new `/api/market/:stockCode/daily` endpoint is trivial; the rendering code stays the same.

**Rationale**: The brief says "차트는 기존 프로젝트에 있는 라이브러리를 우선 사용하고, 없으면 Recharts 사용". Recharts is already in. No change needed beyond passing the new payload's `rows` array.

---

## 10. Test strategy

**Decision** (test scope, ordered by importance):

1. **Auth integration test** (`tests/auth.test.js`): register → login → me → logout flow returns expected statuses; password is never echoed back.
2. **Cross-user isolation test** (`tests/crossUserIsolation.test.js`): User A creates a strategy; User B's session cannot read/update/delete it; User B's `GET /api/strategies` does not include it.
3. **Credential masking test** (`tests/kiwoomCredential.test.js`): POST a credential with a 36-char App Key, GET the credential settings → response contains `appKeyMasked` only, no plaintext `appKey`, no `secretKey`, no `token`.
4. **Kiwoom auth service test** (`tests/kiwoomAuthService.test.js`): with `fetch` replaced by a test double, simulate token issuance success, expiration + reissue, 401 → retry once, network failure → sanitized message containing the EC2 IP.
5. **Market routes test** (`tests/marketRoutes.test.js`): `/api/market/005930/daily` calls Kiwoom when stored data is missing, reuses stored rows when the requested range is already covered, and `(user_id, stock_code, date)` rows are unique after both calls.
6. **Bundle audit (CI gate, not a test file)**: `npm run build` then `grep -E '(KIWOOM|Bearer|appkey|secretkey)' frontend/dist/assets/*` must return zero matches. Documented in `quickstart.md`; can be turned into a script later.

**No frontend automated tests for MVP** — we rely on the `quickstart.md` manual E2E walkthrough plus a build-output grep gate. Adding Vitest is a follow-up.

**`fetch` test doubles**: Node 22's built-in `fetch` is replaced inside tests via `globalThis.fetch = testFn`; restored in `afterEach`. No `nock`, no `msw`.

---

## 11. Out-of-scope for this feature (explicit follow-ups)

These were called out in the brief or surfaced during research; documented here so they don't re-appear as "should we do this" surprises later:

- **백테스트 / 백테스트 리포트** — separate spec, separate feature branch.
- **Paper-trading hardening** — improving the existing virtual-order semantics (e.g., partial fills, cooldowns) is its own feature.
- **키움 실주문** — explicitly forbidden in this feature. A future spec would add `/api/orders/place` etc. and would be guarded by `ENABLE_LIVE_ORDER=true` plus a per-user opt-in.
- **이메일 인증, 비밀번호 찾기, 소셜 로그인** — out per brief.
- **Rate limiting on login / register** — a sensible follow-up; for MVP we rely on bcrypt cost and the small user pool.
- **Admin tooling** (list users, force-revoke a credential) — not required for MVP; the operator can read/edit SQLite directly.
- **CSRF tokens** — not needed for MVP given same-origin + SameSite=Lax. Revisit if frontend ever moves to a different origin.
- **`SECRET_ENCRYPTION_KEY` rotation runbook** — write when first rotation is needed.

---

## Summary

| Area | Decision |
|---|---|
| Password hashing | bcrypt cost 12 |
| Auth carrier | server-side session in SQLite, httpOnly+SameSite=Lax+Secure cookie |
| Secret encryption | AES-256-GCM via `node:crypto`, single key from `SECRET_ENCRYPTION_KEY` |
| Logging | small redacting wrapper; no plaintext secrets in logs |
| Kiwoom token | per-user `KiwoomAuthService`, in-memory + DB cache, single 401 retry, friendly IP-allowlist guidance |
| Market cache | per-user `(user_id, stock_code, date)` upsert, 6-month default range |
| Existing data | gated migration that requires `SEED_OWNER_USER_ID` env to backfill non-empty tables |
| Frontend auth | small AuthContext, no router, view-switch shell |
| Charting | reuse Recharts 2 (no new dep) |
| Tests | Node `node:test` integration tests + manual quickstart + bundle grep gate |

No `[NEEDS CLARIFICATION]` items remain.
