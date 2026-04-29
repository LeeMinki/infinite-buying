# Contract: Account API

**Feature**: 002-user-auth-and-kiwoom-market-data
**Base path**: `/api/account`
**Auth**: All endpoints require an authenticated session.

These endpoints are read-only helpers for strategy creation. They must never place or prepare real orders.

---

## GET `/api/account/deposit`

Fetch account deposit/orderable cash values for the signed-in user's selected Kiwoom environment.

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | `{ "deposit": 5000000, "availableOrderAmount": 4500000, "source": "KIWOOM", "fetchedAt": "2026-04-29T05:12:33.000Z" }` | Production Kiwoom account lookup succeeded |
| `200 OK` | `{ "deposit": 5000000, "availableOrderAmount": 4500000, "source": "MOCK", "fetchedAt": "2026-04-29T05:12:33.000Z" }` | Mock environment uses app-owned mock account data |
| `400 Bad Request` | `{ "error": "키움 설정이 저장되어 있지 않습니다." }` | No credential |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |
| `503 Service Unavailable` | `{ "error": "..." }` | Production Kiwoom account lookup failed |

**Behavior notes**:

- The frontend uses `availableOrderAmount` first and falls back to `deposit` when filling `totalBudget`.
- Mock mode MUST NOT fail just because `mockapi.kiwoom.com` lacks the account endpoint; it returns app-owned mock values.
- The endpoint never returns App Key, Secret Key, access token, account password, account number, or any order-capable payload.
