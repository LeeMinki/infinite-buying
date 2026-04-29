# Feature Specification: Multi-User Auth and Per-User Kiwoom Market Data

**Feature Branch**: `002-user-auth-and-kiwoom-market-data`
**Created**: 2026-04-29
**Status**: Draft
**Input**: User description: "001 MVP에 회원가입/로그인, 사용자별 데이터 분리, 사용자별 키움 REST API 설정, 키움 시장 데이터 조회 기능을 추가한다."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign Up, Sign In, and Keep Each User's Data Private (Priority: P1)

A new visitor creates an account with an email and password, signs in, and only sees their own strategies, holdings, virtual orders, and decision logs. Anything created by another user is invisible and unreachable, even if a strategy id from another account is requested directly. Signing out ends the session and re-protects every protected screen and API.

**Why this priority**: Without authentication and per-user data scoping, the existing 001 MVP cannot be safely shared on a public domain. Every other capability in this feature (Kiwoom credentials, market data) requires a known, isolated account. Auth + isolation is the smallest slice that makes the deployed app multi-user-safe.

**Independent Test**: Can be fully tested by registering two accounts, creating one strategy under each, and confirming that each account only lists its own strategy and that any direct attempt to read or modify the other account's strategy/holding/order/log is rejected. Logging out from either account must block all protected endpoints until the user signs back in.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor, **When** they submit the registration form with a valid, previously-unused email and an acceptable password, **Then** the account is created, the password is stored only as a one-way salted hash, and the user is signed in.
2. **Given** an existing account, **When** the user submits the correct email and password on the sign-in form, **Then** an authenticated session is established and protected screens become accessible.
3. **Given** an existing account, **When** the user submits a wrong password or a non-existent email, **Then** the request is rejected with a generic "이메일 또는 비밀번호가 올바르지 않습니다." style message that does not disclose which field was wrong.
4. **Given** two signed-in users, User A and User B, **When** User B requests `/api/strategies/{id}` for a strategy owned by User A, **Then** the system responds as if the strategy does not exist (404 or equivalent) and never returns A's data.
5. **Given** an authenticated user, **When** the user clicks logout, **Then** the session is invalidated and any subsequent protected request must redirect to or render the sign-in screen.
6. **Given** an unauthenticated request to any protected endpoint (strategies, holdings, virtual orders, decision logs, Kiwoom setup, market data), **When** the request is received, **Then** the system rejects it with an unauthenticated error and does not return any data.
7. **Given** the registration form, **When** an email that is already registered is submitted, **Then** the request is rejected with an "이미 가입된 이메일입니다." style message.

---

### User Story 2 - Configure Personal Kiwoom REST API Credentials with IP Guidance (Priority: P2)

A signed-in user opens the Kiwoom Setup screen, follows a step-by-step preparation guide that explains how to issue an App Key and Secret Key on the Kiwoom REST API site and which **EC2 outbound public IP** to register on Kiwoom's "계좌 App Key 관리" screen, then saves their App Key and Secret Key. After saving, the App Key is shown only in masked form, the Secret Key is never displayed again, and a "연결 테스트" button verifies that the backend can issue a Kiwoom access token. If the connection test fails, the user sees a clear suggestion that the EC2 IP may not be registered on Kiwoom yet. The user can also delete their saved credential to start over.

**Why this priority**: Each user must use their **own** Kiwoom App Key and Secret Key — keys cannot be shared across accounts on Kiwoom's side. Without per-user credential storage, no user-driven market data lookup is possible. This story is independently valuable because saving and verifying credentials is itself a complete deliverable, even before market data is wired into the strategy screen.

**Independent Test**: Can be fully tested by signing in, opening the Kiwoom Setup screen, confirming the screen displays the EC2 Elastic IP and the preparation guide, saving an App Key and Secret Key, observing that the App Key is masked and the Secret Key disappears from the UI, pressing "연결 테스트" and confirming the result reflects whether a Kiwoom access token can be issued, and finally deleting the credential and seeing the screen return to the unconfigured state.

**Acceptance Scenarios**:

1. **Given** a signed-in user with no saved Kiwoom credential, **When** they open the Kiwoom Setup screen, **Then** the screen shows the EC2 Elastic IP value, a preparation checklist (open a Kiwoom account → apply for REST API → issue App/Secret Keys → register the EC2 Elastic IP on Kiwoom's App Key 관리 화면 → return here and enter the keys), and an explicit warning that the IP to register is the **backend server's outbound public IP, not the user's PC IP**.
2. **Given** the Kiwoom Setup screen, **When** the user enters an App Key and Secret Key and selects an environment (PROD or MOCK) and submits the form, **Then** the credential is saved per-user with the App Key and Secret Key stored encrypted at rest, and the user lands on a "configured" view that shows only a masked App Key.
3. **Given** a saved credential, **When** the user reloads the Kiwoom Setup screen, **Then** the Secret Key is **not** shown anywhere in the UI or in any API response, and the App Key appears only in masked form (e.g., first 4 + last 4 characters with the rest replaced).
4. **Given** a saved credential, **When** the user wants to change the Secret Key, **Then** the only available path is to re-enter a new Secret Key (the old value cannot be retrieved or shown).
5. **Given** a saved credential, **When** the user presses "연결 테스트", **Then** the backend uses the user's encrypted credential to call the Kiwoom token endpoint and the screen reflects whether a token was issued (success state shows "연결 성공", failure state shows a friendly message).
6. **Given** a connection test that fails because Kiwoom rejected the request, **When** the failure message is shown, **Then** the screen explicitly suggests "Kiwoom 사이트에 EC2 Elastic IP가 등록되어 있는지 확인해 주세요." as a likely cause, alongside the displayed IP value.
7. **Given** a saved credential, **When** the user presses "삭제", **Then** the credential row (App Key, Secret Key, any cached token) is removed and the screen returns to the unconfigured state.
8. **Given** any Kiwoom-related backend response, **When** it is sent to the frontend, **Then** the response body never contains the App Key, Secret Key, or access token in clear form.

---

### User Story 3 - Look Up Live Price and Daily Chart Through the Backend (Priority: P3)

On the strategy detail screen, the signed-in user clicks "현재가 조회" and the backend uses the user's saved Kiwoom credential to fetch the live price for that stock; the value is auto-filled into the evaluate input. The user also sees a daily chart panel populated by the backend with daily OHLCV bars retrieved through Kiwoom and persisted in a per-user cache so repeated views don't refetch the same days. Each panel shows whether the data came from KIWOOM (just fetched), CACHE (local), or MOCK (mock environment). If Kiwoom is unavailable or the credential is missing/invalid, the user can still type the current price manually and continue evaluation.

**Why this priority**: The 001 MVP already supports manual price entry, so this story is an enhancement layered on top. It depends on stories 1 and 2, but it is the visible payoff that unlocks the "press a button, see real price" experience and the actual chart panel that exists in the UI today.

**Independent Test**: Can be fully tested by signing in as a user who has configured Kiwoom credentials, opening a strategy on stock 005930, pressing "현재가 조회" and observing that the price field populates with a Kiwoom-sourced value while the data-source indicator reads "KIWOOM"; opening the chart panel and confirming roughly six months of daily candles render with a "KIWOOM" indicator the first time and "CACHE" on a subsequent reload of the same day range; intentionally invalidating the credential and confirming the manual-price fallback still works.

**Acceptance Scenarios**:

1. **Given** a signed-in user with valid Kiwoom credentials, **When** they press "현재가 조회" on a strategy for stock 005930, **Then** the backend fetches the current price using that user's credential and returns the price plus a data-source label of "KIWOOM"; the price is auto-filled into the evaluate input.
2. **Given** a signed-in user with valid Kiwoom credentials, **When** the strategy detail screen loads daily-chart data for stock 005930 covering at least the most recent six months, **Then** the backend fetches missing days from Kiwoom, persists them in a per-user daily-price store, and returns the chart series with a per-row source of "KIWOOM" or "CACHE".
3. **Given** the per-user daily-price store already contains rows for `(userId, stockCode, date)`, **When** the same range is requested again, **Then** no duplicate rows are written and existing rows are returned with source "CACHE".
4. **Given** a user with no saved Kiwoom credential, **When** they press "현재가 조회", **Then** the backend rejects the call with a friendly message that points the user to the Kiwoom Setup screen.
5. **Given** the user's Kiwoom token has expired, **When** any market-data call is made, **Then** the backend transparently re-issues the token using the stored credential and proceeds.
6. **Given** a Kiwoom call fails (timeout, network error, IP not registered, invalid keys, etc.), **When** the failure is surfaced to the user, **Then** the strategy detail screen retains the manual current-price input as a fallback and the user can still run an evaluation by typing a price.
7. **Given** any market-data API response sent to the frontend, **When** it is inspected, **Then** it does not contain the App Key, Secret Key, or access token.
8. **Given** the deployed bundle, **When** any frontend asset is inspected, **Then** no App Key, Secret Key, or Kiwoom access token is present.

---

### Edge Cases

- A user submits the registration form with an email that differs only in casing from an existing one ("USER@x.com" vs "user@x.com"); the system MUST treat email uniqueness case-insensitively to prevent silent duplicates.
- Two browser tabs of the same user submit "save credential" simultaneously; the system MUST end up with one consistent credential row, not two.
- A user is signed in on tab A, signs out on tab B, then triggers a market-data call from tab A; the protected request MUST be rejected.
- The connection-test endpoint is called repeatedly within a short window; the backend MUST avoid hammering Kiwoom's token endpoint and MUST reuse a valid token if one is already cached.
- A user's saved Kiwoom token is still inside its expiration window but Kiwoom returns "invalid token" for an unrelated reason; the backend MUST treat this as a re-issue trigger and retry once before failing the user-visible call.
- The Kiwoom API returns a partial daily series (e.g., missing the most recent day because the market is closed); the chart MUST render what was returned and MUST NOT fabricate or interpolate missing days.
- The Kiwoom API responds with success but the body is malformed; the backend MUST surface a clear error and MUST NOT crash the user's session or log raw secrets.
- The user manipulates a request body to set `userId` to another account's id; the backend MUST ignore client-supplied user identifiers and use the session-bound user only.
- The user attempts to save an empty Secret Key (e.g., just whitespace); the system MUST reject the input rather than store an unusable credential.
- The deployment is missing one of the required environment values (e.g., `EC2_ELASTIC_IP`, `SECRET_ENCRYPTION_KEY`, or `SESSION_SECRET`); the backend MUST refuse to start rather than silently fall back to defaults that would weaken security.

## Requirements *(mandatory)*

### Functional Requirements

#### Authentication & accounts

- **FR-001**: The system MUST allow an unauthenticated visitor to register an account using an email and a password.
- **FR-002**: The system MUST treat email addresses as case-insensitively unique and MUST reject registrations whose email collides with any existing account.
- **FR-003**: The system MUST store the password only as a one-way, salted, computationally-expensive hash (e.g., bcrypt-class). Plaintext passwords MUST NEVER be stored, logged, or returned.
- **FR-004**: The system MUST allow a registered user to sign in with their email and password and MUST establish an authenticated session backed by an httpOnly, Secure (in production) cookie.
- **FR-005**: The system MUST allow an authenticated user to sign out, after which the session is invalidated server-side.
- **FR-006**: The system MUST expose a "current user" endpoint that returns the signed-in user's id and email (and never the password hash) for the frontend to determine auth state.
- **FR-007**: The system MUST reject every protected API call from an unauthenticated client with a clear unauthenticated error and MUST return no data.
- **FR-008**: Login failure responses (wrong password, unknown email) MUST be indistinguishable to the client to avoid email-enumeration leaks.

#### Per-user data scope

- **FR-009**: The system MUST scope every read, create, update, and delete operation on Strategy, Holding, VirtualOrder, and DecisionLog to the signed-in user only.
- **FR-010**: The system MUST resolve the acting user from the session, NOT from any client-supplied id, and MUST ignore `userId` fields submitted in request bodies.
- **FR-011**: A request that targets a record (Strategy, Holding, VirtualOrder, DecisionLog) owned by another user MUST be rejected as if the record did not exist; cross-user data MUST NEVER appear in any response.
- **FR-012**: Existing 001-MVP records that predate this feature MUST be migrated to belong to a specific user (or removed) before User Story 1 ships; no record may exist in production with a missing owner.

#### Kiwoom credential management

- **FR-013**: The system MUST let each signed-in user save exactly one Kiwoom credential consisting of an App Key, a Secret Key, and an environment selector (PROD or MOCK).
- **FR-014**: The system MUST encrypt the App Key and the Secret Key at rest using a key sourced from `SECRET_ENCRYPTION_KEY`, and MUST refuse to start if that environment value is missing or weak.
- **FR-015**: The system MUST display the App Key only in masked form (showing at most a small prefix and suffix) and MUST never send the unmasked App Key, the Secret Key, or any access token to the frontend.
- **FR-016**: After saving a Secret Key, the system MUST NOT provide any way to retrieve or display the original value; changing it requires re-entering a new Secret Key.
- **FR-017**: The system MUST let the user delete their saved credential, which MUST also clear any cached token associated with that user.
- **FR-018**: The system MUST surface a credential status to the UI with values NOT_CONFIGURED, CONFIGURED, TOKEN_VALID, and TOKEN_ERROR (last error message included only as a sanitized, user-safe string).

#### Kiwoom token lifecycle

- **FR-019**: When a market-data call needs a Kiwoom access token, the system MUST decrypt the user's stored App Key and Secret Key, call Kiwoom's token endpoint, store the resulting token (and its expiration) such that the plaintext token never reaches the frontend, and reuse it until expiration.
- **FR-020**: If the Kiwoom token is missing, expired, or rejected, the system MUST attempt to re-issue it once before failing the user-visible request.
- **FR-021**: A "연결 테스트" action MUST trigger token issuance through the same code path as production calls and MUST return only a sanitized success/failure result to the frontend.
- **FR-022**: When token issuance fails, the user-facing error MUST include guidance that the EC2 Elastic IP may not be registered on Kiwoom's "계좌 App Key 관리" screen, and MUST display the EC2 Elastic IP value sourced from `EC2_ELASTIC_IP`.

#### Kiwoom market data

- **FR-023**: The system MUST expose a "current price" capability that, given a stock code and the signed-in user, returns the latest available price using that user's Kiwoom credential.
- **FR-024**: The system MUST expose a "daily price history" capability that, given a stock code and a date range (`from`, `to`), returns daily OHLCV data sufficient to render the strategy detail chart, defaulting to at least the most recent six months when no range is supplied.
- **FR-025**: The system MUST persist retrieved daily OHLCV rows in a per-user cache keyed by `(userId, stockCode, date)` so the same `(userId, stockCode, date)` row is stored at most once.
- **FR-026**: The system MUST satisfy daily-price requests from the cache for any date already present and MUST fetch only the missing dates from Kiwoom; rows returned to the frontend MUST be tagged with a source of `KIWOOM`, `CACHE`, or `MOCK`.
- **FR-027**: The system MUST translate Kiwoom's response shape into the app's internal OHLCV shape so frontend code is independent of Kiwoom's payload format.

#### Frontend behavior

- **FR-028**: The frontend MUST render a registration screen, a sign-in screen, and a logout control, and MUST gate every protected screen (strategies, strategy detail, Kiwoom setup) on the user being signed in.
- **FR-029**: The frontend MUST render a Kiwoom Setup page that displays the EC2 Elastic IP, the preparation guide, the masked App Key (when configured), the form to enter App/Secret Keys, the connection-test action, and the delete action.
- **FR-030**: The strategy detail screen MUST add a "현재가 조회" button that fills the evaluate input with the backend-returned current price and labels its source (KIWOOM / CACHE / MOCK).
- **FR-031**: The strategy detail screen MUST keep the manual current-price input as a fallback that the user can use even when Kiwoom retrieval has failed.
- **FR-032**: The frontend bundle MUST NOT contain App Keys, Secret Keys, Kiwoom access tokens, or `SECRET_ENCRYPTION_KEY` / `SESSION_SECRET` values.

#### Security & operational guarantees

- **FR-033**: Server logs MUST NEVER contain raw passwords, App Keys, Secret Keys, or Kiwoom access tokens; any log of a credential-bearing request MUST redact those fields.
- **FR-034**: The system MUST NOT expose any endpoint that places a real Kiwoom order while `ENABLE_LIVE_ORDER=false` (the MVP default), and the codebase for this feature MUST NOT include a Kiwoom order endpoint at all.
- **FR-035**: The set of required environment values for this feature is `EC2_ELASTIC_IP`, `KIWOOM_API_BASE_URL`, `KIWOOM_MOCK_API_BASE_URL`, `SECRET_ENCRYPTION_KEY`, `SESSION_SECRET`, and `ENABLE_LIVE_ORDER`; the backend MUST validate their presence on startup.
- **FR-036**: Cross-user access attempts (story 1, scenario 4) MUST be observable in audit-style server logs (with userIds but without secrets) so misuse can be investigated later.

### Key Entities *(include if feature involves data)*

- **User**: A registered account. Attributes: id, email (unique, case-insensitive), passwordHash, createdAt, updatedAt. Owns Strategies, Holdings (transitively), VirtualOrders, DecisionLogs, KiwoomCredential, and MarketPriceCache rows.
- **KiwoomCredential**: A user's encrypted Kiwoom REST API credential plus its lifecycle state. Attributes: id, userId (unique — one credential per user), appKeyMasked (display-only), appKeyEncrypted, secretKeyEncrypted, tokenEncrypted (nullable), tokenExpiresAt (nullable), environment (PROD or MOCK), status (NOT_CONFIGURED, CONFIGURED, TOKEN_VALID, TOKEN_ERROR), lastTokenIssuedAt, lastTokenErrorMessage (sanitized), createdAt, updatedAt.
- **MarketPriceCache**: Per-user daily OHLCV cache. Attributes: id, userId, stockCode, date, open, high, low, close, volume, source (KIWOOM, CACHE, MOCK), createdAt, updatedAt. Unique key: (userId, stockCode, date).
- **Strategy** (existing — extended): Adds an owning userId reference. Becomes invisible to any user other than its owner.
- **Holding** (existing — scoped): Reachable only through a Strategy whose userId matches the session user. Either gains a userId column or is access-checked through Strategy.userId.
- **VirtualOrder** (existing — scoped): Same scoping rule as Holding.
- **DecisionLog** (existing — scoped): Same scoping rule as Holding.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can complete registration and sign-in (combined) in under 60 seconds when they already know their email and password.
- **SC-002**: After this feature ships, no user can read, list, modify, or delete any other user's strategy, holding, virtual order, or decision log; this is verified by a cross-user access test that MUST fail with a not-found-style response on every protected endpoint.
- **SC-003**: From the moment a signed-in user opens the Kiwoom Setup screen for the first time, they can save valid credentials and run a successful "연결 테스트" in under 5 minutes, assuming they already have an issued App Key and Secret Key.
- **SC-004**: When a user with valid Kiwoom credentials presses "현재가 조회" on stock 005930, the price is returned and auto-filled within 3 seconds in the median case under normal Kiwoom availability.
- **SC-005**: A first daily-chart load for the most recent six months of stock 005930 returns within 5 seconds in the median case; a subsequent load of the same range for the same user returns within 1 second by serving from cache.
- **SC-006**: After a daily-chart load, no `(userId, stockCode, date)` triple has more than one row in the daily-price store; this is verified by a uniqueness check on the cache table.
- **SC-007**: Inspecting any backend response sent to the browser (auth, strategies, Kiwoom setup, market data) reveals no plaintext password, App Key, Secret Key, or access token; verified by a response-body audit on every endpoint touched by this feature.
- **SC-008**: Inspecting the built frontend bundle reveals no App Key, Secret Key, or Kiwoom access token strings; verified by a build-output grep gate in the release process.
- **SC-009**: When the connection test fails because the EC2 Elastic IP is not yet registered on Kiwoom, 100% of users see a message that names the EC2 IP and instructs them to register it, rather than a generic error.
- **SC-010**: After this feature ships, no Kiwoom order endpoint exists in the backend route table; verified by a route inventory check.

## Assumptions

- Email/password registration with one credential per user is sufficient for the MVP. Social login, password reset, email verification, and multi-factor authentication are explicitly out of scope (the brief calls these out).
- Authenticated sessions are backed by httpOnly cookies signed with `SESSION_SECRET`. Token-bearer schemes (JWT in localStorage) are intentionally not used because the brief mandates that secrets and tokens never reach the frontend.
- Each user has at most one active Kiwoom credential. Switching environment (PROD ↔ MOCK) is done by editing or re-saving the existing credential, not by maintaining two parallel credentials per user.
- "EC2 Elastic IP" is the deployment's stable outbound IP, sourced from the `EC2_ELASTIC_IP` env var. The user is responsible for keeping that value correct and for registering it on Kiwoom's site.
- The encryption mechanism for App Key / Secret Key / cached access token uses a symmetric algorithm keyed off `SECRET_ENCRYPTION_KEY`; the exact algorithm is a planning-phase decision (constraint: the key must not be derivable from anything in the frontend bundle or in source control).
- "Recent 6 months" of daily data is the default window for the strategy detail chart. Users may request narrower or wider ranges, but the default first load covers ~6 months.
- Existing 001-MVP data either belongs to a single seed user that the operator creates during the migration step, or is wiped before this feature's first production deploy. There is no multi-user data already in production prior to this feature.
- Kiwoom REST API behavior (token endpoint, current-price endpoint, daily-price endpoint, error shapes, IP whitelist behavior) follows the public Kiwoom REST API documentation; the planning phase will pin exact endpoint paths and request shapes.
- The deployment continues to use SQLite as the primary store, hosted on the same EC2 instance as the Node.js backend; per-user concurrency expectations remain modest (single-digit concurrent users).
- Real ordering is permanently disabled in this feature: `ENABLE_LIVE_ORDER=false` is the only supported value, and no Kiwoom order endpoint is implemented.
