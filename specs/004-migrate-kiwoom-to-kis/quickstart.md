# Quickstart: Migrate Kiwoom to KIS

## Environment

```bash
KIS_API_BASE_URL=https://openapi.koreainvestment.com:9443
SECRET_ENCRYPTION_KEY=<base64-encoded 32-byte key>
SESSION_SECRET=<32 characters or longer>
ENABLE_LIVE_ORDER=false
ENABLE_RESERVED_ORDER=false
```

## Local Run

```bash
npm install
npm test
npm run build
npm run dev
```

## Manual Flow

1. Register or log in.
2. Open `KIS 설정`.
3. Save KIS App Key and App Secret.
4. Run connection test.
5. Open `백테스트`.
6. Use default symbol `TQQQ` or select another KIS symbol such as `005930`.
7. Enter date range, budget, split count, target profit rate, and restart option.
8. Run backtest.
9. Confirm summary, trades, asset curve, and average price chart use the selected symbol's currency.

## Expected API Responses

Current price:

```json
{
  "symbol": "TQQQ",
  "market": "US",
  "exchange": "NAS",
  "price": 70.25,
  "currency": "USD",
  "source": "KIS_API",
  "fetchedAt": "2026-05-12T00:00:00.000Z"
}
```

Daily candle:

```json
{
  "symbol": "TQQQ",
  "market": "US",
  "exchange": "NAS",
  "date": "2026-04-28",
  "open": 70,
  "high": 71,
  "low": 69,
  "close": 70.5,
  "volume": 12345678,
  "currency": "USD",
  "source": "KIS_API"
}
```

## Validation

```bash
npm test
npm run build
rg -n "KIS_API_BASE_URL|ENABLE_RESERVED_ORDER" backend frontend README.md
rg -n "/api/live/orders|reserved/orders" backend/src frontend/src
```

The second grep should return no matches.
