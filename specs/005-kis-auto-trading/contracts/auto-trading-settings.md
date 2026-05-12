# Contract: Auto Trading Settings

All endpoints require an authenticated user session. Responses must only include the current user's data. Raw App Secret, access token, and account number values must never be returned.

## GET `/api/auto-trading/settings`

Returns the current user's auto-trading setting. If no row exists yet, the response returns a safe default with live orders disabled.

Response 200:

```json
{
  "liveOrderEnabled": false,
  "liveOrderEnabledUpdatedAt": "2026-05-12T05:00:00.000Z",
  "createdAt": "2026-05-12T05:00:00.000Z",
  "updatedAt": "2026-05-12T05:00:00.000Z"
}
```

## PUT `/api/auto-trading/settings/live-order`

Updates the current user's live-order setting and records history when the value changes.

Request:

```json
{
  "liveOrderEnabled": true
}
```

Response 200:

```json
{
  "liveOrderEnabled": true,
  "liveOrderEnabledUpdatedAt": "2026-05-12T05:02:00.000Z",
  "createdAt": "2026-05-12T05:00:00.000Z",
  "updatedAt": "2026-05-12T05:02:00.000Z"
}
```

Validation errors:

```json
{
  "error": "liveOrderEnabled 값이 올바르지 않습니다."
}
```

## History persistence

`user_trading_setting_histories` rows are written every time the live-order setting value actually changes (previous and new boolean values plus `changed_at`). A user-facing history listing endpoint is not exposed in this iteration; the history table exists for audit/operational queries only.

## Safety Notes

- The default is always `liveOrderEnabled=false`.
- Toggling on does not start strategies by itself.
- Toggling off must prevent all future real-order requests immediately.
- Setting reads/writes are scoped by the authenticated `userId`.
