# Contract: Auto Trading Strategies

All endpoints require authentication. Every strategy, decision, position, and order is scoped to the current user. Requests for another user's id return 404.

## POST `/api/auto-trading/strategies`

Creates an auto-trading strategy in `CREATED` state.

Request:

```json
{
  "symbol": "TQQQ",
  "symbolName": "ProShares UltraPro QQQ",
  "market": "US",
  "currency": "USD",
  "totalBudget": 4000,
  "splitCount": 40,
  "targetProfitRate": 0.1,
  "bigBuyPremiumRate": 0.1
}
```

Response 201:

```json
{
  "id": 101,
  "symbol": "TQQQ",
  "symbolName": "ProShares UltraPro QQQ",
  "market": "US",
  "currency": "USD",
  "status": "CREATED",
  "totalBudget": 4000,
  "splitCount": 40,
  "buyAmountPerRound": 100,
  "targetProfitRate": 0.1,
  "bigBuyPremiumRate": 0.1,
  "currentRound": 0,
  "startedAt": null,
  "stoppedAt": null,
  "lastEvaluatedAt": null,
  "lastOrderAt": null,
  "lastDecision": null,
  "lastErrorMessage": null,
  "createdAt": "2026-05-12T05:00:00.000Z",
  "updatedAt": "2026-05-12T05:00:00.000Z"
}
```

Validation:

- `symbol`, `market`, and `currency` are required.
- `totalBudget`, `splitCount`, and `targetProfitRate` must be positive.
- `bigBuyPremiumRate` must be zero or greater. Default `0.1` means the big-number half can buy up to 10% above the previous close or KIS base price.
- `buyAmountPerRound` is derived from budget and split count.

The legacy `maxOrderAmount` and `maxDailyOrderAmount` fields are no longer part of this contract. Requests that still include them are ignored. The corresponding DB columns are kept and written as 0 for migration safety.

## GET `/api/auto-trading/strategies`

Lists current user's strategies.

Response 200:

```json
[
  {
    "id": 101,
    "symbol": "TQQQ",
    "symbolName": "ProShares UltraPro QQQ",
    "market": "US",
    "currency": "USD",
    "status": "RUNNING",
    "lastDecision": "DRY_RUN",
    "lastEvaluatedAt": "2026-05-12T05:05:00.000Z",
    "updatedAt": "2026-05-12T05:05:00.000Z"
  }
]
```

## GET `/api/auto-trading/strategies/:id`

Returns the bare strategy object for the requested id (404 if it belongs to another user).

Response 200:

```json
{
  "id": 101,
  "symbol": "TQQQ",
  "symbolName": "ProShares UltraPro QQQ",
  "market": "US",
  "currency": "USD",
  "status": "RUNNING",
  "totalBudget": 4000,
  "splitCount": 40,
  "buyAmountPerRound": 100,
  "targetProfitRate": 0.1,
  "bigBuyPremiumRate": 0.1,
  "currentRound": 3,
  "startedAt": "2026-05-12T05:01:00.000Z",
  "stoppedAt": null,
  "lastEvaluatedAt": "2026-05-12T05:05:00.000Z",
  "lastOrderAt": "2026-05-12T05:05:00.000Z",
  "lastDecision": "BUY",
  "lastErrorMessage": null
}
```

The latest position snapshot, open orders, and recent decisions are fetched separately via the dedicated endpoints below so the FE can refresh them on its own cadence.

## PUT `/api/auto-trading/strategies/:id`

Updates editable fields for CREATED, STOPPED, or ERROR strategies. RUNNING strategies may only allow risk-limit updates if implementation chooses to permit it; otherwise return a safe validation error.

Request:

```json
{
  "totalBudget": 5000,
  "splitCount": 40,
  "targetProfitRate": 0.1,
  "bigBuyPremiumRate": 0.1
}
```

Response 200: updated strategy object.

## DELETE `/api/auto-trading/strategies/:id`

Deletes the strategy and cascades related rows (position snapshots, orders, decision logs, locks, daily usages) via foreign-key cascade.

Response 204: empty body.

Notes:

- The strategy must belong to the current user; otherwise the response is the standard "not found" error.
- Already submitted KIS orders are not canceled at the broker — the linked DB rows are removed locally only.

## POST `/api/auto-trading/strategies/:id/start`

Starts a strategy.

Response 200:

```json
{
  "id": 101,
  "status": "RUNNING",
  "startedAt": "2026-05-12T05:01:00.000Z",
  "stoppedAt": null
}
```

## POST `/api/auto-trading/strategies/:id/stop`

Stops a strategy. Does not cancel existing orders.

Response 200:

```json
{
  "id": 101,
  "status": "STOPPED",
  "stoppedAt": "2026-05-12T05:10:00.000Z"
}
```

## POST `/api/auto-trading/strategies/:id/evaluate`

Runs one manual evaluation using the same path as scheduled evaluation. The response wraps the post-evaluation strategy, the decision log row that was just persisted, the position snapshot, and the order record (when one was created).

Response 200:

```json
{
  "strategy": {
    "id": 101,
    "symbol": "TQQQ",
    "status": "RUNNING",
    "currentRound": 3,
    "lastDecision": "BUY",
    "lastEvaluatedAt": "2026-05-12T05:05:00.000Z",
    "lastOrderAt": "2026-05-12T05:05:00.000Z",
    "lastErrorMessage": null
  },
  "decision": {
    "id": 9001,
    "decision": "BUY",
    "currentPrice": 41.8,
    "averagePrice": 0,
    "holdingQuantity": 0,
    "cashAvailable": 4000,
    "currentRound": 0,
    "expectedQuantity": 2,
    "expectedOrderPrice": 41.8,
    "expectedAmount": 83.6,
    "liveOrderEnabled": false,
    "reason": "실주문 실행이 꺼져 있어 DRY_RUN 주문만 기록했습니다.",
    "createdAt": "2026-05-12T05:05:00.000Z"
  },
  "snapshot": {
    "id": 7001,
    "symbol": "TQQQ",
    "quantity": 0,
    "averagePrice": 0,
    "currentPrice": 41.8,
    "cashAvailable": 4000,
    "capturedAt": "2026-05-12T05:05:00.000Z"
  },
  "order": {
    "id": 5001,
    "status": "DRY_RUN",
    "side": "BUY",
    "quantity": 2,
    "orderPrice": 41.8,
    "estimatedAmount": 83.6
  }
}
```

When the decision does not produce an order (e.g., HOLD, SKIP, ERROR, or safety-blocked), `order` is `null`. When KIS token acquisition fails before any KIS call, `snapshot` and `order` are `null` and the strategy/decision rows reflect the failure path with a safe error message.

Failure response:

```json
{
  "error": "KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요"
}
```

## GET `/api/auto-trading/strategies/:id/decisions`

Returns decision logs for the strategy.

Response 200:

```json
[
  {
    "id": 9001,
    "symbol": "TQQQ",
    "market": "US",
    "currency": "USD",
    "currentPrice": 41.8,
    "averagePrice": 42.1,
    "holdingQuantity": 1,
    "cashAvailable": 4000,
    "currentRound": 1,
    "decision": "BUY",
    "expectedQuantity": 2,
    "expectedOrderPrice": 41.8,
    "expectedAmount": 83.6,
    "liveOrderEnabled": false,
    "reason": "실주문 실행이 꺼져 있어 DRY_RUN 주문만 기록했습니다.",
    "targetSellPrice": 46.31,
    "distanceToTargetRate": 0.0974,
    "openOrderCount": 0,
    "evaluationSource": "MANUAL",
    "orderId": 5001,
    "createdAt": "2026-05-12T05:05:00.000Z"
  }
]
```

Field notes:

- `targetSellPrice` — `averagePrice × (1 + targetProfitRate)`. Null when the strategy has no position yet.
- `distanceToTargetRate` — `(targetSellPrice - currentPrice) / targetSellPrice`. Zero or negative means the price has reached the target sell price; positive is the remaining upside required.
- `openOrderCount` — KIS open orders at evaluation time. Same value also appears inside `reason` text; this field exists so the UI can filter/sort without parsing strings.
- `evaluationSource` — `SCHEDULED` if the background scheduler produced the log, `MANUAL` if the user pressed "지금 평가".
- `orderId` — back-link to the order row that this evaluation produced. Null when no order was created (HOLD/SKIP/ERROR/COMPLETED).

## GET `/api/auto-trading/account-summary?strategyId=:id`

Returns a safe account summary for the selected strategy. The UI uses it both as a "is my KIS connection working" check and as the live-trading account display. KIS is queried in both record mode and live-order mode so that users can confirm their account is reachable before turning on real orders.

Response 200 (always the same shape; `liveOrderEnabled` echoes the user setting so the UI can render the right wording):

```json
{
  "liveOrderEnabled": false,
  "symbol": "TQQQ",
  "symbolName": "ProShares UltraPro QQQ",
  "market": "US",
  "currency": "USD",
  "currentPrice": 41.8,
  "cashAvailable": 3900,
  "cashAvailableAfterFx": 7.62,
  "buyableQuantity": 93,
  "buyableQuantityAfterFx": 0,
  "exchangeRate": 1311.5,
  "holdingQuantity": 2,
  "averagePrice": 42.1,
  "evaluationAmount": 83.6,
  "unrealizedProfit": -0.6,
  "openOrderCount": 0,
  "checkedAt": "2026-05-12T05:05:00.000Z"
}
```

Overseas-specific fields:

- `cashAvailable` — KIS `frcr_ord_psbl_amt1` (현재 외화 잔고 기준 매수가능금액). For integrated-margin accounts this already includes the FX-converted home-currency portion.
- `cashAvailableAfterFx` — KIS `echm_af_ord_psbl_amt` (현재 home-currency 잔고를 지금 환전한다고 가정했을 때 가능한 외화 금액). Useful for users who haven't enrolled in integrated-margin to see how much they'd have after FX.
- `buyableQuantityAfterFx` — KIS `echm_af_ord_psbl_qty`.
- `exchangeRate` — KIS `exrt`. The applied FX rate; useful for showing approximate home-currency equivalents in the UI.

For domestic strategies, `cashAvailable` is the KRW order cash and the `*AfterFx` / `exchangeRate` fields are 0.

Notes:

- The same endpoint is used whether or not live-order mode is on. Live-order mode does not gate the read path; only real-order submission is gated by SafetyGuard.
- KIS returns balance/buying-power numbers in the symbol's settlement currency (KRW for domestic, the response currency for overseas). `cashAvailable` for overseas symbols already includes the KIS integrated-margin adjustment when the account is enrolled.
- Failure response: standard `{ "error": "safe message" }`. Common causes: missing account number/product code in KIS settings, invalid App Key/Secret, or the server IP not registered with KIS.
- The raw account number, App Secret, and access token are never returned.

## GET `/api/auto-trading/buying-power-preview?market=:market&symbol=:symbol[&exchange=:exchange]`

Lightweight endpoint used by the strategy creation form to recommend a starting total budget. Does not require an existing strategy. KIS is queried with the supplied symbol/market so we get the same buying-power fields as the account summary.

Response 200:

```json
{
  "market": "US",
  "symbol": "TQQQ",
  "currency": "USD",
  "currentPrice": 41.8,
  "cashAvailable": 0,
  "cashAvailableAfterFx": 7.62,
  "buyableQuantity": 0,
  "buyableQuantityAfterFx": 0,
  "exchangeRate": 1311.5,
  "checkedAt": "2026-05-12T05:05:00.000Z"
}
```

Notes:

- For domestic markets (`market=KR`), `symbol` defaults to `005930` if not supplied; the call only needs to return the cash buying power for the account, so the symbol just affects which buying-power endpoint KIS uses.
- Current price lookup is best-effort; if it fails the endpoint still returns the buying-power numbers it can fetch.
- The UI uses `cashAvailable` and `cashAvailableAfterFx` to present one-click recommended budgets but never auto-overwrites the user's manual input.
- Failure response: standard `{ "error": "safe message" }`. Raw account number, App Secret, and access token are never returned.

## GET `/api/auto-trading/strategies/:id/positions`

Returns recent position snapshots.

Response 200:

```json
[
  {
    "id": 7001,
    "symbol": "TQQQ",
    "market": "US",
    "currency": "USD",
    "quantity": 2,
    "averagePrice": 42.1,
    "currentPrice": 41.8,
    "evaluationAmount": 83.6,
    "unrealizedProfit": -0.6,
    "unrealizedProfitRate": -0.0071,
    "cashAvailable": 3900,
    "source": "KIS",
    "decision": "HOLD",
    "capturedAt": "2026-05-12T05:05:00.000Z"
  }
]
```

`decision` is the BUY/SELL/HOLD/SKIP/ERROR/COMPLETED label produced by the evaluation that captured this snapshot. It is nullable for older rows that predate the column.
