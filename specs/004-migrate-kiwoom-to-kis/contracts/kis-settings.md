# Contract: KIS Settings API

**Base path**: `/api/settings/kis`
**Auth**: Required for all endpoints.

All endpoints resolve the acting user from the httpOnly session. Request bodies must not be able to set another `userId`.

## GET `/api/settings/kis`

Returns the current user's KIS credential status.

Response 200, unconfigured:

```json
{
  "configured": false,
  "status": "NOT_CONFIGURED",
  "appKeyMasked": "",
  "accountConfigured": false,
  "lastTokenIssuedAt": "",
  "lastTokenErrorMessage": ""
}
```

Response 200, configured:

```json
{
  "configured": true,
  "status": "TOKEN_VALID",
  "appKeyMasked": "ABCD****WXYZ",
  "accountConfigured": true,
  "lastTokenIssuedAt": "2026-05-12T00:00:00.000Z",
  "lastTokenErrorMessage": ""
}
```

Security:

- Never returns raw App Key, App Secret, access token, account number, or account product code.

## POST `/api/settings/kis`

Creates or replaces the current user's KIS credential and clears old token state.

Request:

```json
{
  "appKey": "KIS_APP_KEY",
  "appSecret": "KIS_APP_SECRET",
  "accountNumber": "optional",
  "accountProductCode": "optional"
}
```

Validation:

- `appKey`: required, non-empty after trim.
- `appSecret`: required, non-empty after trim.
- `accountNumber`, `accountProductCode`: optional for the current flow.

Response 200:

```json
{
  "configured": true,
  "status": "CONFIGURED",
  "appKeyMasked": "ABCD****WXYZ",
  "accountConfigured": true,
  "lastTokenIssuedAt": "",
  "lastTokenErrorMessage": ""
}
```

## DELETE `/api/settings/kis`

Deletes current user's KIS credential and token cache.

Response:

- `204 No Content`

## POST `/api/settings/kis/test`

Issues a KIS token using the saved credential.

Response 200, success:

```json
{
  "ok": true,
  "status": "TOKEN_VALID",
  "appKeyMasked": "ABCD****WXYZ",
  "message": "KIS access token 발급에 성공했습니다."
}
```

Response, failure:

```json
{
  "ok": false,
  "status": "TOKEN_ERROR",
  "message": "KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요"
}
```

Failure messages must be sanitized and must not echo raw KIS payloads when they may contain secrets.
