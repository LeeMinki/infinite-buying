# Contract: Auto Trading Orders

All endpoints require authentication and are scoped to the current user.

## GET `/api/auto-trading/orders`

Lists current user's auto-trading orders. Supports optional filters by `strategyId`, `status`, `symbol`, and date range.

Response 200:

```json
[
  {
    "id": 5001,
    "strategyId": 101,
    "symbol": "TQQQ",
    "market": "US",
    "currency": "USD",
    "side": "BUY",
    "quantity": 2,
    "orderPrice": 41.8,
    "estimatedAmount": 83.6,
    "kisOrderNo": null,
    "kisOriginalOrderNo": null,
    "status": "DRY_RUN",
    "filledQuantity": null,
    "remainingQuantity": null,
    "averageFilledPrice": null,
    "decisionReason": "실주문 실행이 꺼져 있어 DRY_RUN 주문만 기록했습니다.",
    "liveOrderEnabled": false,
    "errorMessage": null,
    "createdAt": "2026-05-12T05:05:00.000Z",
    "updatedAt": "2026-05-12T05:05:00.000Z"
  }
]
```

## GET `/api/auto-trading/orders/:id`

Returns current user's order detail.

Response 200:

```json
{
  "id": 5002,
  "strategyId": 101,
  "symbol": "TQQQ",
  "market": "US",
  "currency": "USD",
  "side": "BUY",
  "quantity": 2,
  "orderPrice": 41.8,
  "estimatedAmount": 83.6,
  "kisOrderNo": "0000004336",
  "kisOriginalOrderNo": "01790",
  "status": "ACCEPTED",
  "filledQuantity": 0,
  "remainingQuantity": 2,
  "averageFilledPrice": null,
  "idempotencyKey": "auto:101:2026-05-12:BUY:BUY",
  "decisionReason": "안전 검증을 통과해 실제 매수 주문을 요청했습니다.",
  "liveOrderEnabled": true,
  "requestPayloadMasked": {
    "market": "US",
    "symbol": "TQQQ",
    "side": "BUY",
    "quantity": 2
  },
  "responsePayloadMasked": {
    "orderNo": "0000004336",
    "orderTime": "160524"
  },
  "errorMessage": null,
  "createdAt": "2026-05-12T05:05:00.000Z",
  "updatedAt": "2026-05-12T05:05:10.000Z"
}
```

Not found:

```json
{
  "error": "주문을 찾을 수 없습니다."
}
```

## POST `/api/auto-trading/orders/:id/refresh`

Refreshes order state from KIS order/fill/open-order records and updates the local order.

Response 200:

```json
{
  "id": 5002,
  "status": "PARTIALLY_FILLED",
  "filledQuantity": 1,
  "remainingQuantity": 1,
  "averageFilledPrice": 41.75,
  "updatedAt": "2026-05-12T05:06:00.000Z"
}
```

Refresh failure:

```json
{
  "error": "주문 상태를 갱신하지 못했습니다. KIS 주문/체결 상태를 확인하세요."
}
```

## Status Mapping

- No KIS order request because live orders are off: `DRY_RUN`
- Request stored before KIS response: `REQUESTED`
- KIS accepted the order: `ACCEPTED`
- KIS rejected the order: `REJECTED`
- Some quantity filled and some remains: `PARTIALLY_FILLED`
- All quantity filled: `FILLED`
- Order canceled externally or by broker state: `CANCELED`
- Request failed safely: `FAILED`
- KIS response cannot be confidently mapped: `UNKNOWN`

## Safety Notes

- DRY_RUN records must never call KIS order endpoints.
- Request/response payload fields are masked summaries only.
- Raw App Secret, access token, and account number must not appear.
- Refresh must not create new orders.
