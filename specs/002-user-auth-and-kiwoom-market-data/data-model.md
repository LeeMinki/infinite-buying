# Phase 1 Data Model: Multi-User Auth and Per-User Kiwoom Market Data

**Feature**: 002-user-auth-and-kiwoom-market-data
**Date**: 2026-04-29
**Storage**: SQLite (better-sqlite3, WAL mode unchanged from 001 MVP)

This document is the single source of truth for the SQL schema after this feature ships. The migration ordering is also defined here; `backend/src/db/migrate.js` will execute `migrations/0001_*.sql` … `0004_*.sql` in alphabetical order on startup.

---

## Migration ordering

| File | Purpose | Reversible? |
|---|---|---|
| `0001_users.sql` | Create `users` table. | Drop table |
| `0002_userid_on_existing.sql` | Add `user_id` column to `strategies`, `holdings`, `virtual_orders`, `decision_logs`; backfill from `SEED_OWNER_USER_ID`; enforce NOT NULL + FK. | Manual rollback |
| `0003_kiwoom.sql` | Create `kiwoom_credentials` table. | Drop table |
| `0004_market_cache_userid.sql` | Replace `market_price_cache` with a per-user version (`user_id` column, unique on `(user_id, stock_code, date)`). | Manual rollback |

The existing `backend/src/db/schema.sql` is **frozen** at the 001 baseline. From this feature on, all schema changes live in `backend/src/db/migrations/*.sql` and run on startup. `migrate.js` is updated to read all `.sql` files in that directory in name order.

---

## Entities

### 1. `users` (NEW)

Represents one signed-up account.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Surrogate ID used as foreign key everywhere. |
| `email` | TEXT | NOT NULL, UNIQUE (case-insensitive) | Stored lowercased; uniqueness enforced via `UNIQUE` index on `lower(email)`. |
| `password_hash` | TEXT | NOT NULL | bcrypt (cost 12). Includes embedded salt + cost. |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | ISO-ish; consistent with 001 conventions. |
| `updated_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | Touched on password change. |

**Index**:
- `CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));`

**Validation rules** (enforced at service layer, not schema):
- Email: trimmed, lowercased, must match a basic email regex (no SMTP probe).
- Password: minimum 8 characters; no upper-case requirement (entropy guidance > nuisance complexity rules).

**State transitions**: none — accounts are created and logged in/out; no soft-delete or status field for MVP.

---

### 2. `kiwoom_credentials` (NEW)

One row per user, holding their Kiwoom REST credential plus the most-recent token issuance state.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `user_id` | INTEGER | NOT NULL, UNIQUE, FK → `users(id)` ON DELETE CASCADE | Exactly one credential per user. |
| `app_key_masked` | TEXT | NOT NULL | Display-only; e.g., `UKnw…fan6` (first 4 + last 4). Computed at save time. |
| `app_key_encrypted` | TEXT | NOT NULL | AES-256-GCM ciphertext (base64 IV : tag : ct). |
| `secret_key_encrypted` | TEXT | NOT NULL | Same format. |
| `token_encrypted` | TEXT | NULL | Same format; null until first token issuance. |
| `token_expires_at` | TEXT | NULL | ISO datetime; null when no token. |
| `environment` | TEXT | NOT NULL DEFAULT `'PROD'`, CHECK IN (`'PROD'`,`'MOCK'`) | Selects between `KIWOOM_API_BASE_URL` and `KIWOOM_MOCK_API_BASE_URL`. |
| `status` | TEXT | NOT NULL DEFAULT `'CONFIGURED'`, CHECK IN (`'NOT_CONFIGURED'`,`'CONFIGURED'`,`'TOKEN_VALID'`,`'TOKEN_ERROR'`) | Lifecycle state; `'NOT_CONFIGURED'` is implied by absence of a row, but the value is reserved for an explicit "credential cleared" sentinel if needed. |
| `last_token_issued_at` | TEXT | NULL | Updated on each successful token issuance. |
| `last_token_error_message` | TEXT | NULL | Sanitized, user-safe message (Korean). Cleared on next success. |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | |
| `updated_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | Touched on save / token issuance / status change. |

**State transitions**:
```
                       save credential
NOT_CONFIGURED  ─────────────────────────►  CONFIGURED
       ▲                                          │
       │                                          │ token issuance success
       │                                          ▼
       │  delete credential                  TOKEN_VALID
       └────────────────────────────────┐       │   ▲
                                        │       │   │ next request OK
                                        │       │   │
                                        │       ▼   │
                                        │   TOKEN_ERROR
                                        │       │
                                        │       │ user re-enters keys → CONFIGURED
                                        └───────┘
```

The "configured" tier is what the UI shows when keys are saved but no token has been minted yet (e.g., immediately after save, before "연결 테스트"). On any successful Kiwoom call (token issuance or market call), state advances to `TOKEN_VALID`. On any token-issuance failure, state is `TOKEN_ERROR` and `last_token_error_message` is populated.

**Validation rules**:
- App Key, Secret Key: required, trimmed, must be non-empty after trim.
- Environment: enum.
- The repository never accepts a row whose `app_key_encrypted` or `secret_key_encrypted` is empty.

**Security rules** (FRs 014–017):
- App Key plaintext exits the backend only when:
  (a) the request body of POST `/api/settings/kiwoom` carries it (TLS in flight), or
  (b) it is sent to Kiwoom's `/oauth2/token` (TLS in flight).
- Secret Key plaintext NEVER appears in any backend response.
- Stored cipher text is AES-256-GCM.
- A successful "save" computes `app_key_masked` from the raw App Key before encryption: first 4 chars + `…` + last 4 chars. Anything shorter than 8 chars masks to `*` repeated.

---

### 3. `market_price_cache` (REPLACED)

The 001 MVP table is replaced by a per-user version. Migration `0004` drops the old table and recreates it; existing cached rows (which had no user owner) are discarded. This is acceptable because the cache is recoverable on demand from Kiwoom.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `user_id` | INTEGER | NOT NULL, FK → `users(id)` ON DELETE CASCADE | |
| `stock_code` | TEXT | NOT NULL | E.g., `005930`. |
| `date` | TEXT | NOT NULL | `YYYY-MM-DD`. |
| `open` | REAL | NOT NULL | KRW. |
| `high` | REAL | NOT NULL | |
| `low` | REAL | NOT NULL | |
| `close` | REAL | NOT NULL | |
| `volume` | INTEGER | NOT NULL DEFAULT 0 | |
| `source` | TEXT | NOT NULL DEFAULT `'KIWOOM'`, CHECK IN (`'KIWOOM'`,`'CACHE'`,`'MOCK'`) | What the row was when first written. Reads relabel as needed. |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | |
| `updated_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | Touched on upsert. |

**Indexes**:
- `CREATE UNIQUE INDEX uq_market_cache_user_stock_date ON market_price_cache (user_id, stock_code, date);` — enforces FR-025 / SC-006.
- `CREATE INDEX idx_market_cache_user_stock ON market_price_cache (user_id, stock_code, date);` — supports range scans for the chart endpoint.

**Upsert SQL** (used by the repository):
```sql
INSERT INTO market_price_cache (user_id, stock_code, date, open, high, low, close, volume, source)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, stock_code, date) DO UPDATE SET
  open = excluded.open,
  high = excluded.high,
  low  = excluded.low,
  close = excluded.close,
  volume = excluded.volume,
  source = excluded.source,
  updated_at = datetime('now');
```

---

### 4. `strategies` (EXISTING — `user_id` added)

Adds a single `user_id` column. Pre-existing rows are migrated via `SEED_OWNER_USER_ID`.

| Column | Type | Constraints | Change |
|---|---|---|---|
| `user_id` | INTEGER | NOT NULL, FK → `users(id)` ON DELETE CASCADE | NEW |

Index added: `CREATE INDEX idx_strategies_user ON strategies(user_id);`

All existing columns (`name`, `stock_code`, `stock_name`, `total_budget`, `split_count`, `buy_amount_per_round`, `target_profit_rate`, `current_round`, `status`, `created_at`, `updated_at`) are unchanged.

**Repository contract change**: every function that reads or writes `strategies` now takes `userId` as a required first parameter and adds `WHERE user_id = ?` to the SQL.

---

### 5. `holdings`, `virtual_orders`, `decision_logs` (EXISTING — `user_id` added)

Each gets a `user_id` column with the same NOT NULL + FK ON DELETE CASCADE shape as `strategies`. The column is denormalized (the same value is reachable via `strategies.user_id`) for fast scoped queries. Index added on `user_id` per table.

**Repository contract**: each function takes `userId` as a required parameter and either:
- adds `AND user_id = ?` to its existing WHERE clauses (preferred), OR
- joins to `strategies` and asserts `strategies.user_id = ?` for cross-table access.

The `holdings` table keeps its existing `UNIQUE (strategy_id)` constraint — one holding per strategy is still correct, and `strategy_id` already implies `user_id` via the FK chain.

The `virtual_orders` partial unique index (`uq_virtual_orders_buy_strategy_date_round`) is unchanged: scoping by `strategy_id` already implies a single user.

**Cross-table access invariant** (enforced at repository layer):
> Every read/write of `holdings`, `virtual_orders`, or `decision_logs` MUST either filter by `user_id` directly or join through `strategies` and filter by `strategies.user_id`. There is no path that bypasses both.

---

## Relationship diagram

```
users 1 ──── 1 kiwoom_credentials
  │
  ├── 1 ──── n strategies ──── 1 holdings
  │                       │
  │                       ├── n virtual_orders
  │                       │
  │                       └── n decision_logs
  │
  └── 1 ──── n market_price_cache  (per (stock_code, date))
```

Cascade behavior: deleting a `users` row cascades to `kiwoom_credentials`, `strategies`, `market_price_cache`. Deleting a strategy cascades to its `holdings`, `virtual_orders`, `decision_logs` (already in 001).

---

## Volumes (sanity check)

For a single power user tracking ~10 stocks over 6 months: ~10 stocks × ~120 trading days = ~1.2k rows in `market_price_cache`. Across, say, 20 users: ~24k rows. Negligible for SQLite.

`users`, `kiwoom_credentials`: ≤ low hundreds of rows ever, given the audience.

`sessions` (separate file `data/sessions.db`): one row per active login, GC'd by `express-session` on expiry. Negligible.

---

## Things this data model intentionally does NOT have

- No `roles` / `is_admin` column. Admin is the operator who has SSH; we don't need an in-app admin role for MVP.
- No `kiwoom_orders` table. Real ordering is out of scope.
- No `email_verifications`, `password_resets`. Out per brief.
- No `audit_log` table. Cross-user-access attempts (FR-036) are written to the structured logger, not the DB, for MVP.
