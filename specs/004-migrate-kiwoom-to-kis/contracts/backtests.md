# Contract: KIS Backtests

**Base path**: `/api/backtests`
**Auth**: Required for all endpoints.

Backtests are user-scoped and use KIS-sourced daily OHLC prices.

## POST `/api/backtests`

Creates and executes a symbol backtest. The service ensures KIS daily rows are available for the requested date range before calculation.

Calculation model:

- Algorithm: `LAOR_INFINITE_V2`
- Per-round budget: `totalBudget / splitCount`
- First buy: daily open when there is no holding
- Subsequent buys: big/small LOC-style checks using daily close
- Target sell: daily high reaching `averagePrice * (1 + targetProfitRate)`
- After max rounds: partial sell/reset when the target sell has not occurred
- US/overseas quantities: fractional shares are allowed in the calculation
- Domestic quantities: whole shares

Request:

```json
{
  "symbol": "TQQQ",
  "market": "US",
  "fromDate": "2025-01-01",
  "toDate": "2025-12-31",
  "totalBudget": 40000,
  "splitCount": 40,
  "targetProfitRate": 0.1,
  "restartAfterSell": true
}
```

Response 201:

```json
{
  "id": 42,
  "symbol": "TQQQ",
  "market": "US",
  "fromDate": "2025-01-01",
  "toDate": "2025-12-31",
  "totalBudget": 40000,
  "splitCount": 40,
  "buyAmountPerRound": 1000,
  "targetProfitRate": 0.1,
  "restartAfterSell": true,
  "status": "COMPLETED",
  "dataSource": "KIS_API",
  "currency": "USD",
  "algorithm": "LAOR_INFINITE_V2",
  "initialBudget": 40000,
  "finalAsset": 42850.12,
  "realizedProfit": 2300.5,
  "unrealizedProfit": 549.62,
  "returnRate": 0.071253,
  "maxInvestedAmount": 18000,
  "maxDrawdownRate": 0.12,
  "totalBuyCount": 18,
  "totalSellCount": 2,
  "finalHoldingQuantity": 12,
  "finalAveragePrice": 57.83,
  "notice": "투자 수익을 보장하지 않습니다. 수수료, 세금, 슬리피지, 환율은 계산에서 제외됩니다."
}
```

Failure 400:

```json
{
  "error": "선택한 기간의 TQQQ KIS 일봉 데이터를 가져오지 못했습니다. KIS 설정과 기간을 확인해 주세요."
}
```

## GET `/api/backtests`

Returns current user's KIS backtest runs ordered newest first.

## GET `/api/backtests/:id`

Returns one current-user run. Cross-user ids return `404`.

## GET `/api/backtests/:id/trades`

Returns current-user trade rows ordered by date ascending.

Response 200:

```json
[
  {
    "id": 1001,
    "runId": 42,
    "tradeDate": "2025-01-02",
    "side": "BUY",
    "price": 58.23,
    "quantity": 17.174995,
    "amount": 1000,
    "roundNo": 1,
    "cash": 39000,
    "holdingQuantity": 17.174995,
    "averagePrice": 58.23,
    "investedAmount": 1000,
    "realizedProfit": 0,
    "unrealizedProfit": 0,
    "evaluationAmount": 989.91,
    "totalAsset": 40000,
    "drawdownRate": 0,
    "reason": "첫 매수: 시가 58.23에 17.174995주를 매수했습니다. 사용 금액은 1,000입니다."
  }
]
```

## DELETE `/api/backtests/:id`

Deletes a current-user run and associated trades.

Response:

- `204 No Content`

## Safety Contract

- Backtests may call KIS market-data capabilities only.
- Backtests must not call KIS order or reserved-order capabilities.
- Backtests must use only current-user `KIS_API` price rows for the requested `market`, `symbol`, and date range.
