# Contract: Backtests

All endpoints require authentication and are scoped to the current user.

The UI prepares actual daily prices before creating a backtest:

```http
GET /api/market/{stockCode}/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&requireReal=true
```

That market endpoint fetches actual daily prices through the backend and stores rows for the current user. `POST /api/backtests` uses those current-user rows for calculation.

## POST /api/backtests

Request:

```json
{
  "stockCode": "005930",
  "stockName": "삼성전자",
  "fromDate": "2025-01-01",
  "toDate": "2025-12-31",
  "totalBudget": 4000000,
  "splitCount": 40,
  "targetProfitRate": 0.1,
  "restartAfterSell": false
}
```

Response 201:

```json
{
  "id": 20,
  "stockCode": "005930",
  "fromDate": "2025-01-01",
  "toDate": "2025-12-31",
  "status": "COMPLETED",
  "initialBudget": 4000000,
  "finalAsset": 4280000,
  "realizedProfit": 250000,
  "unrealizedProfit": 30000,
  "returnRate": 0.07,
  "maxInvestedAmount": 1800000,
  "maxDrawdownRate": 0.08,
  "totalBuyCount": 18,
  "totalSellCount": 2,
  "finalHoldingQuantity": 3,
  "finalAveragePrice": 70000,
  "notice": "투자 수익을 보장하지 않습니다."
}
```

Missing price response 400:

```json
{
  "error": "선택한 기간의 실제 가격 데이터가 없습니다. 기간을 조정하거나 키움 설정을 확인해 주세요."
}
```

## GET /api/backtests

Returns current user's runs ordered newest first.

## GET /api/backtests/:id

Returns one run summary. Cross-user ids return 404.

## GET /api/backtests/:id/trades

Returns trade/evaluation rows ordered by date ascending.

Response 200:

```json
[
  {
    "id": 501,
    "runId": 20,
    "tradeDate": "2025-01-02",
    "side": "BUY",
    "price": 70000,
    "quantity": 1,
    "amount": 70000,
    "roundNo": 1,
    "cash": 3930000,
    "holdingQuantity": 1,
    "averagePrice": 70000,
    "realizedProfit": 0,
    "unrealizedProfit": 0,
    "evaluationAmount": 70000,
    "totalAsset": 4000000,
    "drawdownRate": 0,
    "reason": "Per-round budget can buy shares"
  }
]
```

## DELETE /api/backtests/:id

Deletes current user's run and associated trades.

Response 204.

## Safety Contract

- Backtest execution reads only current user's actual daily price rows.
- Backtest execution does not call Kiwoom or any external market provider.
- Cross-user run/trade ids return 404.
