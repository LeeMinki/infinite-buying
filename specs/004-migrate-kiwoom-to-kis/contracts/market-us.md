# Contract: KIS Market Data API

**Base path**: `/api/market`
**Auth**: Required for all endpoints.

All endpoints use the current user's saved KIS credential and are read-only. These endpoints must not call KIS order or reserved-order capabilities.

## GET `/api/market/stocks/search`

Searches a domestic stock code or overseas symbol through KIS product information APIs.

Query params:

- `q`: stock code or symbol, for example `005930` or `TQQQ`.

Response 200:

```json
{
  "items": [
    {
      "symbol": "TQQQ",
      "name": "PROSHARES ULTRAPRO QQQ",
      "market": "US",
      "exchange": "NAS",
      "currency": "USD",
      "fractionalTradingAvailable": true,
      "source": "KIS_API"
    }
  ]
}
```

## GET `/api/market/:market/:symbol/price`

Fetches a domestic or overseas current price through KIS.

Path params:

- `market`: `KR` or `US`.
- `symbol`: domestic stock code or overseas symbol. Normalized to uppercase.

Response 200:

```json
{
  "symbol": "TQQQ",
  "market": "US",
  "exchange": "NAS",
  "currency": "USD",
  "price": 58.23,
  "source": "KIS_API",
  "fetchedAt": "2026-05-12T03:20:00.000Z"
}
```

Errors:

- `400`: invalid symbol or missing KIS credential.
- `401`: unauthenticated.
- `502` or `503`: KIS request failed or returned unusable data.

## GET `/api/market/:market/:symbol/daily`

Fetches and stores daily OHLCV rows through KIS.

Query params:

- `from`: required, `YYYY-MM-DD`.
- `to`: required, `YYYY-MM-DD`.
- `exchange`: optional KIS overseas exchange code, e.g. `NAS`.

Response 200:

```json
[
  {
    "symbol": "TQQQ",
    "market": "US",
    "exchange": "NAS",
    "date": "2026-05-08",
    "open": 57.12,
    "high": 58.44,
    "low": 56.9,
    "close": 58.23,
    "volume": 123456789,
    "currency": "USD",
    "source": "KIS_API"
  }
]
```

Behavior:

- Rows are sorted ascending by `date`.
- Rows are upserted by `(userId, market, symbol, date)`.
- Existing rows from other users are never returned.
- Domestic rows use KRW. US rows use USD.

Errors:

- `400`: invalid symbol/date range or missing KIS credential.
- `401`: unauthenticated.
- `502` or `503`: KIS request failed or returned unusable data.
