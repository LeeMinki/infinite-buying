# Contract: Market API

**Feature**: 002-user-auth-and-kiwoom-market-data
**Base path**: `/api/market`
**Auth**: All endpoints require an authenticated session.

These endpoints replace the 001 MVP's `/api/market/*`. The new versions resolve `userId` from the session, look up that user's Kiwoom credential, and use the user's encrypted token (transparently issuing/refreshing as needed).

---

## GET `/api/market/:stockCode/price`

Fetch the latest current price for a stock using the signed-in user's Kiwoom credential.

**Path params**:
- `stockCode`: 6-digit Korean stock code (e.g., `005930`).

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | `{ "stockCode": "005930", "price": 70900, "source": "KIWOOM", "fetchedAt": "2026-04-29T05:12:33.000Z" }` | Kiwoom call succeeded |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |
| `503 Service Unavailable` | `{ "error": "...", "manualFallback": true }` | Kiwoom credential is missing or the Kiwoom call failed |

`source` is always `"KIWOOM"` for current-price (no caching). On failure, the frontend keeps the manual current-price input enabled (FR-031).

---

## GET `/api/market/stocks/search`

Search stocks for strategy creation. The browser never calls Kiwoom directly; it sends the query to the backend, and the backend uses the signed-in user's production Kiwoom credential.

**Query params**:
- `q`: required free-text query. Can be a stock code fragment (`005930`) or stock-name fragment (`삼성`).

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | `{ "items": [{ "stockCode": "005930", "stockName": "삼성전자", "source": "KIWOOM" }] }` | Kiwoom search succeeded |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |
| `503 Service Unavailable` | `{ "error": "..." }` | Production Kiwoom stock-list lookup failed |

**Behavior notes**:
- The backend uses Kiwoom stock-information list data and filters by `stockCode` or `stockName`.
- Response bodies never include App Key, Secret Key, or access token.

---

## GET `/api/market/:stockCode/daily`

Fetch a daily OHLCV series for a stock. Backed by the user's `market_price_cache` plus on-demand Kiwoom calls when stored rows do not cover the requested date range.

**Path params**:
- `stockCode`: 6-digit Korean stock code.

**Query params**:
- `from`: optional, `YYYY-MM-DD`. Defaults to today − 6 months.
- `to`: optional, `YYYY-MM-DD`. Defaults to today (KST).
- `requireReal`: optional boolean. When `true`, only Kiwoom-sourced stored rows are considered usable.
- `refresh`: optional boolean. When `true`, the backend skips stored rows and calls Kiwoom.

**Validation**:
- If both supplied, `from <= to`.
- Range may not exceed 24 months (sanity bound; 6-month default and slightly larger user-driven ranges are fine).

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | see "Daily response" below | Success |
| `400 Bad Request` | `{ "error": "조회 기간이 올바르지 않습니다." }` | Invalid `from`/`to` |
| `400 Bad Request` | `{ "error": "키움 설정이 저장되어 있지 않습니다." }` | No credential AND cache empty for the requested range |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |
| `502 Bad Gateway` | `{ "error": "Kiwoom 일봉 조회에 실패했어요." }` | Kiwoom call failed AND cache could not satisfy the range |

**Daily response**:
```json
[
  { "stockCode": "005930", "date": "2025-10-30", "open": 71800, "high": 72100, "low": 71500, "close": 71900, "volume": 12345678, "source": "KIWOOM" },
  { "stockCode": "005930", "date": "2025-10-31", "open": 71900, "high": 72500, "low": 71700, "close": 72400, "volume": 9876543, "source": "KIWOOM" },
  { "stockCode": "005930", "date": "2026-04-29", "open": 70500, "high": 70900, "low": 70200, "close": 70900, "volume": 11122233, "source": "KIWOOM" }
]
```

Rows are sorted ascending by `date`. Current rows are Kiwoom-sourced; the storage layer may reuse already saved rows for the same user/stock/date range.

---

## Cross-cutting

- All market endpoints scope reads/writes to `market_price_cache` by `userId`. Two users requesting the same stock get separate cache rows.
- A failed Kiwoom request never deletes existing stored price rows.
- Response bodies NEVER contain App Key, Secret Key, or access token (FR-015, FR-032).
