# Quickstart: Real-Price Backtest

## Preconditions

- User is logged in.
- User saved valid Kiwoom App Key / Secret Key.
- Server IP is registered in Kiwoom.
- `MARKET_DATA_PROVIDER=kiwoom`.
- `ENABLE_LIVE_ORDER=false`.

## Browser Flow

1. Open `키움 설정` and verify connection.
2. Open `백테스트`.
3. Search/select a stock.
4. Enter date range, total budget, split count, target profit rate, and restart-after-sell.
5. Click `백테스트 실행`.
6. Confirm summary, trade table, asset chart, and average-price-vs-close chart.

## API Flow

Prepare actual daily prices:

```bash
curl -i -b jar.txt "http://localhost:4000/api/market/005930/daily?from=2025-01-01&to=2025-12-31&requireReal=true&refresh=true"
```

Run backtest:

```bash
curl -i -b jar.txt -H 'Content-Type: application/json' \
  -d '{"stockCode":"005930","stockName":"삼성전자","fromDate":"2025-01-01","toDate":"2025-12-31","totalBudget":4000000,"splitCount":40,"targetProfitRate":0.1,"restartAfterSell":false}' \
  http://localhost:4000/api/backtests
```

## Verification

```bash
npm test
npm run build
```

Expected:

- Tests pass.
- Build passes.
- Only the backtest workflow is available.
