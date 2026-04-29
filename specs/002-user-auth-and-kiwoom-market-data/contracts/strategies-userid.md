# Contract: Per-User Scoping of Existing Strategy / Order / Log Endpoints

**Feature**: 002-user-auth-and-kiwoom-market-data
**Base paths affected**: `/api/strategies`, `/api/orders` (existing 001 MVP endpoints)
**Auth**: ALL endpoints under these prefixes now require an authenticated session.

This contract documents how the 001 MVP routes change to enforce per-user isolation (FR-009, FR-010, FR-011). No URL paths or response bodies change beyond the auth requirement; the change is **who is allowed to read/write each row**.

---

## Universal rules

1. The session middleware runs before every route under `/api/strategies` and `/api/orders` and rejects unauthenticated requests with `401 { "error": "로그인이 필요합니다." }`.
2. The middleware sets `req.userId` (and `req.user.email`) for downstream handlers.
3. Handlers MUST pass `req.userId` to every repository call. Repositories MUST add `WHERE user_id = ?` (or join `strategies` and assert `strategies.user_id = ?`) to every query.
4. If a request body contains a `userId` field, it MUST be ignored. Logs include the discrepancy at `warn` level when present.
5. A request that targets a row owned by another user MUST respond exactly as if the row did not exist — `404 { "error": "전략을 찾을 수 없어요." }` or `404 { "error": "주문을 찾을 수 없어요." }`. NEVER `403`, because `403` discloses existence.

---

## `/api/strategies` (per-user scope)

| Method | Path | Behavior change |
|---|---|---|
| `GET` | `/api/strategies` | Returns only rows where `strategies.user_id = req.userId`. |
| `POST` | `/api/strategies` | Inserts with `user_id = req.userId`. Ignores any client-supplied `userId`. |
| `GET` | `/api/strategies/:id` | Returns the row only if `user_id = req.userId`; else 404. |
| `PUT` | `/api/strategies/:id` | Updates only if `user_id = req.userId`; else 404. |
| `DELETE` | `/api/strategies/:id` | Deletes only if `user_id = req.userId`; else 404. Cascade still fires on success. |
| `GET` | `/api/strategies/:id/holding` | Resolves Holding through Strategy.user_id check; 404 on mismatch. |
| `POST` | `/api/strategies/:id/evaluate` | Same. Records DecisionLog and any new VirtualOrder under the same `user_id`. |
| `GET` | `/api/strategies/:id/orders` | Same scoping as the strategy. |
| `GET` | `/api/strategies/:id/logs` | Same scoping as the strategy. |

Response bodies are unchanged from 001; the only externally visible change is "404 instead of returning another user's data."

---

## `/api/orders` (per-user scope)

| Method | Path | Behavior change |
|---|---|---|
| `POST` | `/api/orders/:id/fill` | Updates the order only if its parent strategy is owned by `req.userId`; else 404. |
| `POST` | `/api/orders/:id/cancel` | Same. |

If the 001 codebase has any other handlers under `/api/orders`, the same rule applies: scope by `Strategy.user_id` via join.

---

## Backward compatibility

The 001 MVP currently has a single implicit user. After this feature ships:
- The migration backfills `user_id` to a seed admin user (see `data-model.md` migration `0002_userid_on_existing.sql`).
- The seed user's session is the only one that can see the migrated rows; new users see an empty list of strategies until they create their own.
- No request shape changes, so the existing frontend code paths continue to work after the auth shell is added — the only network failure mode the existing UI would see is `401`, which the new `AuthContext` traps and converts into a "show login" state.

---

## Negative test (mandatory in the test suite)

`tests/crossUserIsolation.test.js` MUST exercise:
1. Register A and B, both via the auth API.
2. As A, `POST /api/strategies` with `{ name, stockCode, ... }`. Note the returned `id`.
3. As B (separate cookie jar), `GET /api/strategies` → response MUST NOT include A's strategy.
4. As B, `GET /api/strategies/{aId}` → 404.
5. As B, `PUT /api/strategies/{aId}` with new name → 404; A's row unchanged.
6. As B, `DELETE /api/strategies/{aId}` → 404; A's row still exists.
7. As B, `POST /api/strategies/{aId}/evaluate` → 404.
8. As A, `GET /api/strategies/{aId}` → 200 (sanity).
