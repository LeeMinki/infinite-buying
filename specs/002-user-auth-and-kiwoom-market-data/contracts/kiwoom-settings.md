# Contract: Kiwoom Settings API

**Feature**: 002-user-auth-and-kiwoom-market-data
**Base path**: `/api/settings/kiwoom`
**Auth**: All endpoints require an authenticated session.

The acting user is always resolved from the session cookie — never from the request body or URL.

---

## GET `/api/settings/kiwoom`

Read the current user's Kiwoom credential status. **Never** returns the raw App Key, Secret Key, or access token.

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | see "Configured response" below | User has saved a credential (or never has) |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |

**Configured response** (when a credential row exists):
```json
{
  "status": "TOKEN_VALID",
  "appKeyMasked": "UKnw…fan6",
  "environment": "PROD",
  "ec2ElasticIp": "13.124.x.x",
  "lastTokenIssuedAt": "2026-04-29T05:12:33.000Z",
  "lastTokenErrorMessage": null
}
```

**Unconfigured response** (no row yet):
```json
{
  "status": "NOT_CONFIGURED",
  "appKeyMasked": null,
  "environment": null,
  "ec2ElasticIp": "13.124.x.x",
  "lastTokenIssuedAt": null,
  "lastTokenErrorMessage": null
}
```

`ec2ElasticIp` is always returned, sourced from `process.env.EC2_ELASTIC_IP`, so the UI can render the IP-allowlist guidance even before any credential is saved.

---

## POST `/api/settings/kiwoom`

Create or replace the current user's Kiwoom credential. Replacing a credential clears any cached token associated with the user.

**Request body**:
```json
{
  "appKey": "UKnwhBdg8BkHF4JYrNY2XVKmse3Ofan6mDffqMqT8bI",
  "secretKey": "K4ru6WKAUs-1iSyAQVHl5hwWPYAtNDs_vUTUNCHgN7U",
  "environment": "PROD"
}
```

**Validation**:
- `appKey`: required, trimmed, non-empty.
- `secretKey`: required, trimmed, non-empty.
- `environment`: required, must be `"PROD"` or `"MOCK"`.

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | Same shape as `GET /api/settings/kiwoom` configured response, with `status: "CONFIGURED"` and `lastTokenIssuedAt: null`, `lastTokenErrorMessage: null` | Saved |
| `400 Bad Request` | `{ "error": "App Key를 입력해 주세요." }` etc. | Validation failure |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |

**Security**:
- The App Key and Secret Key are encrypted before insert. They are NEVER persisted in plaintext.
- `appKeyMasked` is computed as: first 4 + `…` + last 4 chars (or `********` if length < 8).
- The response must NOT contain `appKey` (raw), `secretKey`, or `tokenEncrypted`.
- On a save that succeeds while a previous credential existed, `token_encrypted` and `token_expires_at` are set to NULL.

---

## DELETE `/api/settings/kiwoom`

Delete the current user's Kiwoom credential and clear any cached token.

**Responses**:

| Status | Body | When |
|---|---|---|
| `204 No Content` | (empty) | Deleted, or no credential existed (idempotent) |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |

**Side effects**:
- Deletes the user's `kiwoom_credentials` row.
- Evicts the user's entry from `KiwoomAuthService`'s in-memory token cache.

---

## POST `/api/settings/kiwoom/test`

Run a Kiwoom token issuance for the current user and report the outcome. Updates `status`, `last_token_issued_at`, `last_token_error_message`.

**Request body**: empty.

**Responses**:

| Status | Body | When |
|---|---|---|
| `200 OK` | `{ "ok": true, "status": "TOKEN_VALID", "issuedAt": "2026-04-29T05:12:33.000Z" }` | Kiwoom returned a token |
| `400 Bad Request` | `{ "error": "키움 설정이 저장되어 있지 않습니다. 먼저 App Key와 Secret Key를 등록해 주세요." }` | No credential saved |
| `401 Unauthorized` | `{ "error": "로그인이 필요합니다." }` | No session |
| `502 Bad Gateway` | `{ "ok": false, "status": "TOKEN_ERROR", "message": "Kiwoom 사이트에 EC2 Elastic IP 13.124.x.x 가 등록되어 있는지 확인해 주세요." }` | Kiwoom rejected token issuance — message is sanitized and includes the EC2 IP per FR-022 |

**Security**:
- The response NEVER contains the access token, App Key, Secret Key.
- `message` is one of a small set of curated Korean strings — it never echoes Kiwoom's raw `return_msg` (which could include sensitive trace info).
