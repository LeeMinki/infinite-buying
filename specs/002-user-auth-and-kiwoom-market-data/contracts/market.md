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
| `400 Bad Request` | `{ "error": "키움 설정이 저장되어 있지 않습니다. 먼저 키움 설정을 등록해 주세요." }` | No credential — frontend should redirect to Kiwoom Setup |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |
| `502 Bad Gateway` | `{ "error": "Kiwoom 시세 조회에 실패했어요. 잠시 후 다시 시도하거나 수동으로 가격을 입력해 주세요." }` | Kiwoom call failed |

`source` is always `"KIWOOM"` for current-price (no caching). On `502`, the frontend keeps the manual current-price input enabled (FR-031).

---

## GET `/api/market/:stockCode/daily`

Fetch a daily OHLCV series for a stock. Backed by `market_price_cache` plus on-demand Kiwoom calls for missing dates.

**Path params**:
- `stockCode`: 6-digit Korean stock code.

**Query params**:
- `from`: optional, `YYYY-MM-DD`. Defaults to today − 6 months.
- `to`: optional, `YYYY-MM-DD`. Defaults to today (KST).

**Validation**:
- If both supplied, `from <= to`.
- Range may not exceed 24 months (sanity bound; 6-month default and slightly larger user-driven ranges are fine).

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | see "Daily response" below | Success (rows may include `source` mix of `KIWOOM` and `CACHE`) |
| `400 Bad Request` | `{ "error": "조회 기간이 올바르지 않습니다." }` | Invalid `from`/`to` |
| `400 Bad Request` | `{ "error": "키움 설정이 저장되어 있지 않습니다." }` | No credential AND cache empty for the requested range |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |
| `502 Bad Gateway` | `{ "error": "Kiwoom 일봉 조회에 실패했어요." }` | Kiwoom call failed AND cache could not satisfy the range |

**Daily response**:
```json
{
  "stockCode": "005930",
  "from": "2025-10-30",
  "to": "2026-04-29",
  "summary": {
    "fromCache": 110,
    "fromKiwoom": 12,
    "totalRows": 122
  },
  "rows": [
    { "date": "2025-10-30", "open": 71800, "high": 72100, "low": 71500, "close": 71900, "volume": 12345678, "source": "CACHE" },
    { "date": "2025-10-31", "open": 71900, "high": 72500, "low": 71700, "close": 72400, "volume": 9876543, "source": "CACHE" },
    "…",
    { "date": "2026-04-29", "open": 70500, "high": 70900, "low": 70200, "close": 70900, "volume": 11122233, "source": "KIWOOM" }
  ]
}
```

`rows` are sorted ascending by `date`. Each row's `source` reflects whether THIS request fetched the row from Kiwoom or read it from the local cache. (Rows newly upserted from Kiwoom are marked `KIWOOM` for this response; on the next call they'll come back as `CACHE`.)

---

## Cross-cutting

- All market endpoints scope reads/writes to `market_price_cache` by `userId`. Two users requesting the same stock get separate cache rows.
- A 502 from Kiwoom NEVER deletes existing cache rows — partial degradation: we serve what we have and tell the user the rest failed.
- Response bodies NEVER contain App Key, Secret Key, or access token (FR-015, FR-032).
