# Contract: Auto Trading Dashboard

All dashboard data is scoped to the authenticated user.

## GET `/api/auto-trading/dashboard`

Returns a compact dashboard view for automatic trading.

Response 200:

```json
{
  "settings": {
    "liveOrderEnabled": false,
    "liveOrderEnabledUpdatedAt": "2026-05-12T05:02:00.000Z"
  },
  "stats": {
    "runningStrategyCount": 2,
    "errorStrategyCount": 1,
    "todayOrderAmount": 83.6
  },
  "strategies": [
    {
      "id": 101,
      "symbol": "TQQQ",
      "market": "US",
      "currency": "USD",
      "status": "RUNNING",
      "lastDecision": "BUY",
      "lastEvaluatedAt": "2026-05-12T05:05:00.000Z",
      "lastErrorMessage": null,
      "updatedAt": "2026-05-12T05:05:00.000Z"
    },
    {
      "id": 103,
      "symbol": "005930",
      "market": "KR",
      "currency": "KRW",
      "status": "ERROR",
      "lastErrorMessage": "KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요",
      "updatedAt": "2026-05-12T05:04:00.000Z"
    }
  ],
  "recentDecisions": [
    {
      "id": 9001,
      "strategyId": 101,
      "symbol": "TQQQ",
      "market": "US",
      "currency": "USD",
      "decision": "BUY",
      "currentPrice": 41.8,
      "expectedQuantity": 2,
      "expectedAmount": 83.6,
      "liveOrderEnabled": false,
      "reason": "실주문 실행이 꺼져 있어 DRY_RUN 주문만 기록했습니다.",
      "targetSellPrice": 46.31,
      "distanceToTargetRate": 0.0974,
      "openOrderCount": 0,
      "evaluationSource": "SCHEDULED",
      "orderId": 5001,
      "createdAt": "2026-05-12T05:05:00.000Z"
    }
  ],
  "recentOrders": [
    {
      "id": 5001,
      "strategyId": 101,
      "symbol": "TQQQ",
      "side": "BUY",
      "quantity": 2,
      "estimatedAmount": 83.6,
      "status": "DRY_RUN",
      "createdAt": "2026-05-12T05:05:00.000Z"
    }
  ],
  "recentPositions": [
    {
      "strategyId": 101,
      "symbol": "TQQQ",
      "market": "US",
      "currency": "USD",
      "quantity": 2,
      "averagePrice": 42.1,
      "currentPrice": 41.8,
      "evaluationAmount": 83.6,
      "unrealizedProfit": -0.6,
      "unrealizedProfitRate": -0.0071,
      "decision": "HOLD",
      "capturedAt": "2026-05-12T05:05:00.000Z"
    }
  ]
}
```

Field shape notes:

- `settings` (plural) holds the user trading setting object — same shape as `GET /api/auto-trading/settings`.
- `stats` (not `summary`) carries running/error counts and today's accumulated order amount. `todayOrderAmount` is denominated in the active strategy's currency; the dashboard does not surface a separate `todayOrderCurrency` field. The FE selects a currency from the currently chosen strategy when formatting.
- Error strategies are not split into a separate top-level array. They appear in `strategies` (top 20 by recency) with `status: "ERROR"` and a populated `lastErrorMessage`. The UI filters/sorts them as needed.
- `strategies` is limited to the most recent 20 entries.
- `recentDecisions` and `recentOrders` are each limited to the most recent 20.
- `recentPositions` is limited to the most recent 10 position snapshots.

## Display Requirements

- Live-order OFF state must be clearly marked with "실제 주문 없이 기록만 저장 중".
- Live-order ON state must be visually prominent and indicate that real orders may be placed after safety validation.
- Dashboard must include a risk notice that automatic trading can create financial loss and does not guarantee profit.
- Empty states must explain how to create a strategy and configure KIS settings.
